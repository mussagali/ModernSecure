import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import 'data.dart';
import 'ui.dart';

class Workspace extends StatefulWidget {
  const Workspace({super.key, required this.repository});
  final ClientRepository repository;
  @override
  State<Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<Workspace> with WidgetsBindingObserver {
  ClientRepository get repo => widget.repository;
  JsonRow? identity;
  List<JsonRow> cases = [], legal = [];
  CaseData? data;
  int tab = 0, generation = 0;
  bool loading = true, consent = true;
  String? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    generation++;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) load();
  }

  Future<void> load({String? caseId}) async {
    final epoch = ++generation;
    final selected = caseId ?? data?.id;
    setState(() {
      loading = true;
      error = null;
      data = null;
    });
    try {
      final who = await repo.loadIdentity();
      final accepted = await repo.db.rpc('client_consent_status') == true;
      final docs = accepted
          ? <JsonRow>[]
          : rows(
              await repo.db
                  .from('legal_documents')
                  .select()
                  .eq('is_current', true)
                  .neq('document_type', 'marketing'),
            );
      final list = accepted ? await repo.cases() : <JsonRow>[];
      final chosen =
          list.where((c) => c['id'] == selected).firstOrNull ??
          list.firstOrNull;
      final detail = chosen == null ? null : await repo.loadCase(chosen);
      if (!mounted || epoch != generation) return;
      setState(() {
        identity = who;
        consent = accepted;
        legal = docs;
        cases = list;
        data = detail;
        loading = false;
      });
    } catch (e) {
      if (!mounted || epoch != generation) return;
      setState(() {
        loading = false;
        error = e is ClientAccessException
            ? e.message
            : 'Не удалось загрузить кабинет. Проверьте интернет и повторите попытку.';
      });
    }
  }

  void push(String title, Widget child) => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: child,
      ),
    ),
  );
  void more() =>
      push('Ещё', MoreScreen(repo: repo, identity: identity!, data: data));
  void switchCase() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheet) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          const Padding(
            padding: EdgeInsets.all(20),
            child: Text(
              'Выберите дело',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
          ),
          ...cases.map(
            (c) => ListTile(
              title: Text(c['title']),
              subtitle: Text('Дело № ${c['case_number']}'),
              trailing: c['id'] == data?.id
                  ? const Icon(Icons.check_circle, color: blue)
                  : null,
              onTap: () {
                Navigator.pop(sheet);
                load(caseId: c['id']);
              },
            ),
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (error != null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Личный кабинет'),
          actions: [
            IconButton(
              tooltip: 'Выйти',
              onPressed: () => repo.db.auth.signOut(),
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        body: Center(
          child: EmptyNotice(
            'Доступ к кабинету',
            error!,
            action: OutlinedButton(
              onPressed: load,
              child: const Text('Повторить'),
            ),
          ),
        ),
      );
    }
    if (!consent) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Условия и согласия'),
          actions: [
            IconButton(
              tooltip: 'Выйти',
              onPressed: () => repo.db.auth.signOut(),
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text(
              'Ознакомьтесь с действующими документами перед началом работы.',
            ),
            ...legal.map(
              (d) => ExpansionTile(
                title: Text(d['title']),
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: SelectableText(d['body']),
                  ),
                ],
              ),
            ),
            PrimaryButton(
              'Принимаю условия',
              onPressed: () async {
                try {
                  await repo.db.rpc(
                    'accept_client_consents',
                    params: {
                      'p_document_ids': legal.map((d) => d['id']).toList(),
                    },
                  );
                  await load();
                } catch (_) {
                  if (context.mounted) {
                    notify(
                      context,
                      'Не удалось сохранить согласия. Повторите попытку.',
                    );
                  }
                }
              },
            ),
          ],
        ),
      );
    }
    final name = (identity?['full_name'] as String? ?? 'Клиент');
    final page = data == null
        ? const EmptyNotice(
            'Ваше дело появится здесь',
            'Компания ещё не добавила дело к вашему аккаунту. Когда оно будет создано, здесь появятся этапы, документы и сообщения.',
          )
        : switch (tab) {
            0 => HomeScreen(
              data: data!,
              onDocuments: () => setState(() => tab = 2),
              onCase: () => setState(() => tab = 1),
              onChat: () => setState(() => tab = 3),
            ),
            1 => TimelineScreen(data: data!),
            2 => DocumentsScreen(data: data!),
            _ => ChatScreen(key: ValueKey(data!.id), repo: repo, data: data!),
          };
    final title = ['Главная', 'Моё дело', 'Документы', 'Сообщения'][tab];
    return LayoutBuilder(
      builder: (context, size) {
        final wide = size.maxWidth >= 700;
        return Scaffold(
          appBar: AppBar(
            toolbarHeight: 84,
            title: tab == 0
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Добрый день,',
                        style: TextStyle(color: muted, fontSize: 16),
                      ),
                      Text(
                        name.split(' ').first,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  )
                : Text(title),
            actions: [
              IconButton(
                tooltip: 'Уведомления',
                onPressed: () =>
                    push('Уведомления', NotificationsScreen(repo: repo)),
                icon: const Icon(Icons.notifications_none_rounded),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: IconButton(
                  tooltip: 'Профиль и ещё',
                  onPressed: more,
                  icon: CircleAvatar(
                    backgroundColor: const Color(0xFF2466A4),
                    foregroundColor: Colors.white,
                    child: Text(name.characters.first.toUpperCase()),
                  ),
                ),
              ),
            ],
          ),
          body: Row(
            children: [
              if (wide)
                NavigationRail(
                  selectedIndex: tab,
                  onDestinationSelected: (i) => setState(() => tab = i),
                  labelType: NavigationRailLabelType.all,
                  destinations: const [
                    NavigationRailDestination(
                      icon: Icon(Icons.home_outlined),
                      label: Text('Главная'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.work_outline_rounded),
                      label: Text('Моё дело'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.description_outlined),
                      label: Text('Документы'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.chat_bubble_outline_rounded),
                      label: Text('Сообщения'),
                    ),
                  ],
                ),
              Expanded(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 680),
                    child: Column(
                      children: [
                        if (data != null && tab != 2)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                            child: Surface(
                              padding: EdgeInsets.zero,
                              child: ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 4,
                                ),
                                leading: const IconTile(
                                  Icons.description_outlined,
                                ),
                                title: Text(
                                  data!.item['title'],
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                subtitle: Text(
                                  'Дело № ${data!.item['case_number']}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: muted,
                                  ),
                                ),
                                trailing: const Icon(
                                  Icons.unfold_more_rounded,
                                  color: muted,
                                  size: 20,
                                ),
                                onTap: switchCase,
                              ),
                            ),
                          ),
                        if (tab == 2 && cases.length > 1)
                          TextButton.icon(
                            onPressed: switchCase,
                            icon: const Icon(Icons.unfold_more),
                            label: Text('Дело № ${data!.item['case_number']}'),
                          ),
                        Expanded(
                          child: tab == 3 && data != null
                              ? page
                              : RefreshIndicator(
                                  onRefresh: load,
                                  child: ListView(
                                    physics:
                                        const AlwaysScrollableScrollPhysics(),
                                    padding: const EdgeInsets.fromLTRB(
                                      16,
                                      0,
                                      16,
                                      24,
                                    ),
                                    children: [page],
                                  ),
                                ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          bottomNavigationBar: wide
              ? null
              : Container(
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(26),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Color(0x080B3154),
                        offset: Offset(0, -3),
                        blurRadius: 20,
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(26),
                    ),
                    child: NavigationBar(
                      selectedIndex: tab,
                      onDestinationSelected: (i) => setState(() => tab = i),
                      backgroundColor: Colors.white,
                      surfaceTintColor: Colors.transparent,
                      indicatorColor: const Color(0xFFEAF2FF),
                      destinations: const [
                        NavigationDestination(
                          icon: Icon(Icons.home_outlined),
                          selectedIcon: Icon(Icons.home_rounded, color: blue),
                          label: 'Главная',
                        ),
                        NavigationDestination(
                          icon: Icon(Icons.work_outline_rounded),
                          selectedIcon: Icon(Icons.work_rounded, color: blue),
                          label: 'Дело',
                        ),
                        NavigationDestination(
                          icon: Icon(Icons.description_outlined),
                          selectedIcon: Icon(
                            Icons.description_rounded,
                            color: blue,
                          ),
                          label: 'Документы',
                        ),
                        NavigationDestination(
                          icon: Icon(Icons.chat_bubble_outline_rounded),
                          selectedIcon: Icon(
                            Icons.chat_bubble_rounded,
                            color: blue,
                          ),
                          label: 'Сообщения',
                        ),
                      ],
                    ),
                  ),
                ),
        );
      },
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.data,
    required this.onDocuments,
    required this.onCase,
    required this.onChat,
  });
  final CaseData data;
  final VoidCallback onDocuments, onCase, onChat;
  @override
  Widget build(BuildContext context) {
    final pending = data.documents
        .where(
          (d) => [
            'Нужно загрузить',
            'Нужны исправления',
          ].contains(documentStatus(d)),
        )
        .firstOrNull;
    final event = data.events.lastOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: onCase,
          borderRadius: BorderRadius.circular(20),
          child: Surface(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const IconTile(
                  Icons.fact_check_outlined,
                  color: Color(0xFFA66542),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Текущий этап',
                        style: TextStyle(color: muted, fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        data.item['is_suspended'] == true
                            ? 'Дело приостановлено'
                            : data.item['status'] != 'open'
                            ? 'Дело завершено'
                            : data.stage?['title'] ?? 'Этап пока не назначен',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        data.stage?['client_description'] ??
                            'Здесь появится информация о ходе работы.',
                        style: const TextStyle(
                          color: muted,
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                      if (event != null) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Обновлено ${dateLabel(event['occurred_at'])}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (pending != null)
          Surface(
            color: const Color(0xFFFFF4EA),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Что нужно сделать',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF583425),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const IconTile(
                      Icons.upload_file_outlined,
                      color: Color(0xFFD5652E),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            pending['title'],
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            pending['instructions'] ??
                                'Откройте запрос, чтобы посмотреть требования.',
                            style: const TextStyle(color: muted, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                PrimaryButton('Открыть документы', onPressed: onDocuments),
              ],
            ),
          )
        else
          Surface(
            child: Row(
              children: [
                const IconTile(Icons.check_circle_outline, color: green),
                const SizedBox(width: 14),
                const Expanded(
                  child: Text(
                    'Новых запросов документов пока нет. Об изменениях сообщим здесь.',
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 14),
        if (event != null)
          Surface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.history_rounded, size: 18),
                    SizedBox(width: 8),
                    Text(
                      'Последнее обновление',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  dateLabel(event['occurred_at'], time: true),
                  style: const TextStyle(color: muted, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(event['client_note'] ?? 'Этап дела обновлён.'),
              ],
            ),
          ),
        const SizedBox(height: 12),
        Surface(
          padding: EdgeInsets.zero,
          child: ListTile(
            leading: const IconTile(Icons.chat_bubble_outline_rounded),
            title: const Text('Связаться с командой'),
            subtitle: const Text(
              'Переписка по вашему делу',
              style: TextStyle(color: muted, fontSize: 12),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: onChat,
          ),
        ),
      ],
    );
  }
}

class TimelineScreen extends StatelessWidget {
  const TimelineScreen({super.key, required this.data});
  final CaseData data;
  @override
  Widget build(BuildContext context) {
    if (data.stages.isEmpty) {
      return const EmptyNotice(
        'Этапы ещё не опубликованы',
        'План работы появится после настройки дела.',
      );
    }
    final current = data.stages.indexWhere(
      (s) => s['id'] == data.item['current_stage_id'],
    );
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        children: [
          for (var i = 0; i < data.stages.length; i++)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 48,
                    child: Column(
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i == current
                                ? blue
                                : data.events.any(
                                    (e) =>
                                        e['to_stage_id'] ==
                                        data.stages[i]['id'],
                                  )
                                ? green
                                : const Color(0xFFCCD5E0),
                          ),
                          child: Icon(
                            i == current
                                ? Icons.circle
                                : data.events.any(
                                    (e) =>
                                        e['to_stage_id'] ==
                                        data.stages[i]['id'],
                                  )
                                ? Icons.check
                                : Icons.circle,
                            color: Colors.white,
                            size: i == current ? 10 : 15,
                          ),
                        ),
                        if (i < data.stages.length - 1)
                          Expanded(
                            child: Container(
                              width: 2,
                              color: const Color(0xFFD3DAE4),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 0, 4, 28),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            data.stages[i]['title'],
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 5),
                          if (i == current)
                            const Padding(
                              padding: EdgeInsets.only(bottom: 4),
                              child: Text(
                                'Текущий этап',
                                style: TextStyle(color: blue, fontSize: 12),
                              ),
                            ),
                          Text(
                            data.stages[i]['client_description'] ??
                                'Информация появится по мере работы.',
                            style: const TextStyle(color: muted, fontSize: 14),
                          ),
                          ...data.events
                              .where(
                                (e) => e['to_stage_id'] == data.stages[i]['id'],
                              )
                              .map(
                                (e) => Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Text(
                                    '${dateLabel(e['occurred_at'])}${e['client_note'] == null ? '' : '\n${e['client_note']}'}',
                                    style: const TextStyle(
                                      color: muted,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key, required this.data});
  final CaseData data;
  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  int filter = 0;
  @override
  Widget build(BuildContext context) {
    final list = widget.data.documents
        .where(
          (d) =>
              filter == 0 ||
              (filter == 1
                  ? [
                      'Нужно загрузить',
                      'Нужны исправления',
                    ].contains(documentStatus(d))
                  : documentStatus(d) == 'На проверке'),
        )
        .toList();
    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (var i = 0; i < 3; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(['Все', 'Нужно загрузить', 'На проверке'][i]),
                    selected: filter == i,
                    onSelected: (_) => setState(() => filter = i),
                    showCheckmark: false,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (list.isEmpty)
          const EmptyNotice(
            'Документов пока нет',
            'Запросы от вашей команды появятся в этом разделе.',
          ),
        Surface(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Column(
            children: [
              for (final d in list)
                Column(
                  children: [
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(vertical: 8),
                      leading: IconTile(
                        Icons.description_outlined,
                        color: documentStatus(d) == 'Принят' ? green : blue,
                      ),
                      title: Text(
                        d['title'],
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      subtitle: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Wrap(children: [StatusPill(documentStatus(d))]),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: muted,
                      ),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => DocumentDetail(request: d),
                        ),
                      ),
                    ),
                    if (d != list.last) const Divider(height: 1),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class DocumentDetail extends StatelessWidget {
  const DocumentDetail({super.key, required this.request});
  final JsonRow request;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Документ')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          request['title'],
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: StatusPill(documentStatus(request)),
        ),
        const SizedBox(height: 20),
        Text(
          request['instructions'] ?? 'Дополнительные требования не указаны.',
        ),
        if (request['due_at'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text('Срок: ${dateLabel(request['due_at'])}'),
          ),
        const SizedBox(height: 24),
        ...rows(request['document_files'] ?? []).map(
          (f) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Surface(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    f['original_name'],
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    'Версия ${f['version_no']} · ${dateLabel(f['uploaded_at'])}',
                    style: const TextStyle(color: muted, fontSize: 12),
                  ),
                  if (f['return_reason'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('Комментарий: ${f['return_reason']}'),
                    ),
                ],
              ),
            ),
          ),
        ),
        if (request['status'] == 'active')
          const Surface(
            color: Color(0xFFFFF4EA),
            child: Text(
              'Отправка файлов из приложения пока недоступна. Напишите команде в разделе «Сообщения», чтобы уточнить способ передачи документа.',
            ),
          ),
      ],
    ),
  );
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.repo, required this.data});
  final ClientRepository repo;
  final CaseData data;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final input = TextEditingController();
  List<JsonRow> messages = [];
  Map<String, String> authors = {};
  bool busy = false, loading = true, hasMore = false, paging = false;
  String? error, sendKey, sendBody;
  RealtimeChannel? channel;
  Timer? poll;
  @override
  void initState() {
    super.initState();
    load();
    channel = widget.repo.db
        .channel('case-${widget.data.id}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'case_id',
            value: widget.data.id,
          ),
          callback: (_) => load(),
        )
        .subscribe();
    // Refresh fallback also works when the project's Realtime publication is not enabled.
    poll = Timer.periodic(const Duration(seconds: 20), (_) => load());
  }

  @override
  void dispose() {
    poll?.cancel();
    if (channel != null) widget.repo.db.removeChannel(channel!);
    input.dispose();
    super.dispose();
  }

  Future<void> load({bool older = false}) async {
    if (older && (paging || messages.isEmpty)) return;
    if (older) setState(() => paging = true);
    try {
      final result = await widget.repo.messages(
        widget.data.id,
        before: older ? messages.last : null,
      );
      final people = rows(
        await widget.repo.db.rpc(
          'case_message_authors',
          params: {'p_case_id': widget.data.id},
        ),
      );
      if (!mounted) return;
      setState(() {
        if (older) {
          final ids = messages.map((m) => m['id']).toSet();
          messages.addAll(result.where((m) => !ids.contains(m['id'])));
        } else {
          final byId = {
            for (final m in [...messages, ...result]) m['id']: m,
          };
          messages = byId.values.toList()
            ..sort(
              (a, b) => '${b['created_at']}${b['id']}'.compareTo(
                '${a['created_at']}${a['id']}',
              ),
            );
        }
        authors = {
          for (final p in people)
            p['user_id'] as String: p['display_name'] as String,
        };
        if (older || loading) hasMore = result.length == 50;
        loading = false;
        paging = false;
        error = null;
      });
      if (!older && messages.isNotEmpty) {
        await widget.repo.db.rpc(
          'mark_case_messages_seen',
          params: {
            'p_case_id': widget.data.id,
            'p_through_message_id': messages.first['id'],
          },
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          loading = false;
          paging = false;
          error =
              'Не удалось обновить сообщения. Потяните список вниз или повторите позже.';
        });
      }
    }
  }

  Future<void> send() async {
    final body = input.text.trim();
    if (body.isEmpty || busy) return;
    if (body.length > 4000) {
      notify(context, 'Сообщение должно быть не длиннее 4000 символов.');
      return;
    }
    if (sendBody != body) {
      sendKey = const Uuid().v4();
      sendBody = body;
    }
    setState(() => busy = true);
    try {
      await widget.repo.send(widget.data.id, body, sendKey!);
      input.clear();
      sendKey = null;
      sendBody = null;
      await load();
    } catch (_) {
      if (mounted) {
        notify(
          context,
          'Сообщение не отправлено. Текст сохранён — повторите отправку. Дело также может быть закрыто или приостановлено.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      if (error != null)
        MaterialBanner(
          content: Text(error!, style: const TextStyle(fontSize: 12)),
          actions: [
            TextButton(onPressed: load, child: const Text('Повторить')),
          ],
        ),
      Expanded(
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : messages.isEmpty
            ? const Center(
                child: EmptyNotice(
                  'Начните разговор',
                  'Напишите команде по вашему делу. Ответ появится здесь.',
                  icon: Icons.chat_bubble_outline_rounded,
                ),
              )
            : RefreshIndicator(
                onRefresh: load,
                child: ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  itemCount: messages.length + 1,
                  itemBuilder: (context, i) {
                    if (i == messages.length) {
                      return hasMore
                          ? Center(
                              child: TextButton(
                                onPressed: paging
                                    ? null
                                    : () => load(older: true),
                                child: Text(
                                  paging ? 'Загрузка…' : 'Предыдущие сообщения',
                                ),
                              ),
                            )
                          : const SizedBox(height: 12);
                    }
                    final m = messages[i];
                    final own = m['sender_user_id'] == widget.repo.userId;
                    return Align(
                      alignment: own
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Container(
                        constraints: BoxConstraints(
                          maxWidth:
                              MediaQuery.sizeOf(context).width.clamp(300, 680) *
                              .77,
                        ),
                        margin: const EdgeInsets.only(bottom: 14),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: own ? blue : const Color(0xFFE9EEF5),
                          borderRadius: BorderRadius.only(
                            topLeft: const Radius.circular(20),
                            topRight: const Radius.circular(20),
                            bottomLeft: Radius.circular(own ? 20 : 4),
                            bottomRight: Radius.circular(own ? 4 : 20),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (!own)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 5),
                                child: Text(
                                  authors[m['sender_user_id']] ??
                                      'Команда по делу',
                                  style: const TextStyle(
                                    color: muted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            SelectableText(
                              m['body'],
                              style: TextStyle(
                                color: own ? Colors.white : ink,
                                height: 1.5,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              dateLabel(m['created_at'], time: true),
                              style: TextStyle(
                                fontSize: 11,
                                color: own ? const Color(0xFFDCEBFF) : muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
      ),
      SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
          child: widget.data.writable
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: input,
                        enabled: !busy,
                        minLines: 1,
                        maxLines: 5,
                        maxLength: 4000,
                        decoration: const InputDecoration(
                          hintText: 'Напишите сообщение…',
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: 'Отправить сообщение',
                      onPressed: busy ? null : send,
                      style: IconButton.styleFrom(
                        backgroundColor: blue,
                        minimumSize: const Size(48, 48),
                      ),
                      icon: busy
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.arrow_upward_rounded),
                    ),
                  ],
                )
              : const Text(
                  'Переписка доступна для чтения. Дело закрыто или приостановлено.',
                  style: TextStyle(color: muted),
                ),
        ),
      ),
    ],
  );
}

class MoreScreen extends StatelessWidget {
  const MoreScreen({
    super.key,
    required this.repo,
    required this.identity,
    this.data,
  });
  final ClientRepository repo;
  final JsonRow identity;
  final CaseData? data;
  void open(BuildContext context, String title, Widget child) => Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: child,
      ),
    ),
  );
  @override
  Widget build(BuildContext context) {
    final due = data?.schedule
        .where((p) => data!.outstanding(p) > 0)
        .firstOrNull;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Surface(
          child: Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: blue,
                foregroundColor: Colors.white,
                child: Text(
                  (identity['full_name'] as String).characters.first,
                  style: const TextStyle(fontSize: 22),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      identity['full_name'],
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      identity['email'] ?? '',
                      style: const TextStyle(color: muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (due != null) ...[
          Surface(
            child: Row(
              children: [
                const IconTile(Icons.calendar_month_outlined),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Следующий платёж',
                        style: TextStyle(color: muted, fontSize: 12),
                      ),
                      Text(
                        money(data!.outstanding(due)),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        'до ${dateLabel(due['due_on'])}',
                        style: const TextStyle(color: muted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        Surface(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: const Text('Договор и оплаты'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => open(
                  context,
                  'Договор и оплаты',
                  FinanceScreen(data: data),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.notifications_none_rounded),
                title: const Text('Уведомления'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => open(
                  context,
                  'Уведомления',
                  NotificationsScreen(repo: repo),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.person_outline_rounded),
                title: const Text('Профиль'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => open(
                  context,
                  'Профиль',
                  ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      ...['full_name', 'email', 'phone', 'city'].map(
                        (key) => ListTile(
                          title: Text(
                            {
                              'full_name': 'Имя',
                              'email': 'Email',
                              'phone': 'Телефон',
                              'city': 'Город',
                            }[key]!,
                          ),
                          subtitle: SelectableText(
                            identity[key]?.toString() ?? 'Не указано',
                          ),
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text(
                          'Для изменения данных обратитесь к команде по вашему делу.',
                          style: TextStyle(color: muted),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.help_outline_rounded),
                title: const Text('Помощь и контакты'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () =>
                    open(context, 'Помощь и контакты', HelpScreen(repo: repo)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: () async {
            await repo.db.auth.signOut();
            if (context.mounted) {
              Navigator.of(context).popUntil((r) => r.isFirst);
            }
          },
          icon: const Icon(Icons.logout),
          label: const Text('Выйти из аккаунта'),
        ),
      ],
    );
  }
}

class FinanceScreen extends StatelessWidget {
  const FinanceScreen({super.key, this.data});
  final CaseData? data;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      if (data == null || (data!.contracts.isEmpty && data!.schedule.isEmpty))
        const EmptyNotice(
          'Платёжных данных пока нет',
          'Договор и график появятся после публикации компанией.',
        ),
      ...?data?.contracts.map(
        (c) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Surface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Договор № ${c['contract_number']}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Text('Стоимость: ${money(c['price_kzt'])}'),
                Text(
                  'Версия ${c['version_no']} · ${dateLabel(c['signed_on'])}',
                  style: const TextStyle(color: muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
      ...?data?.schedule.map(
        (p) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Surface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  money(p['amount_kzt']),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text('Срок: ${dateLabel(p['due_on'])}'),
                Text(
                  data!.outstanding(p) == 0
                      ? 'Оплата подтверждена'
                      : 'Осталось: ${money(data!.outstanding(p))}',
                  style: TextStyle(
                    color: data!.outstanding(p) == 0 ? green : muted,
                  ),
                ),
                if (p['description'] != null) Text(p['description']),
              ],
            ),
          ),
        ),
      ),
    ],
  );
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.repo});
  final ClientRepository repo;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<JsonRow>> result;
  @override
  void initState() {
    super.initState();
    result = fetch();
  }

  Future<List<JsonRow>> fetch() async => rows(
    await widget.repo.db
        .from('notifications')
        .select()
        .eq('recipient_user_id', widget.repo.userId)
        .order('created_at', ascending: false)
        .limit(100),
  );
  @override
  Widget build(BuildContext context) => FutureBuilder<List<JsonRow>>(
    future: result,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return EmptyNotice(
          'Не удалось загрузить уведомления',
          'Проверьте интернет.',
          action: TextButton(
            onPressed: () => setState(() => result = fetch()),
            child: const Text('Повторить'),
          ),
        );
      }
      if (!snapshot.hasData) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.data!.isEmpty) {
        return const EmptyNotice(
          'Новых уведомлений нет',
          'Здесь появятся сообщения об изменениях в ваших делах.',
          icon: Icons.notifications_none_rounded,
        );
      }
      return ListView(
        padding: const EdgeInsets.all(16),
        children: snapshot.data!
            .map(
              (n) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Surface(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        n['title'],
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (n['body'] != null) Text(n['body']),
                      const SizedBox(height: 8),
                      Text(
                        dateLabel(n['created_at'], time: true),
                        style: const TextStyle(color: muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            )
            .toList(),
      );
    },
  );
}

class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key, required this.repo});
  final ClientRepository repo;
  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  late Future<List<List<JsonRow>>> result;
  Future<List<List<JsonRow>>> fetch() async => [
    rows(await widget.repo.db.from('contact_settings').select()),
    rows(
      await widget.repo.db
          .from('faq_entries')
          .select()
          .eq('published', true)
          .order('position'),
    ),
  ];
  @override
  void initState() {
    super.initState();
    result = fetch();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<List<JsonRow>>>(
    future: result,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return EmptyNotice(
          'Не удалось загрузить контакты',
          'Проверьте интернет.',
          action: TextButton(
            onPressed: () => setState(() => result = fetch()),
            child: const Text('Повторить'),
          ),
        );
      }
      if (!snapshot.hasData) {
        return const Center(child: CircularProgressIndicator());
      }
      final contacts = snapshot.data![0].firstOrNull;
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (contacts == null ||
              [contacts['phone'], contacts['email']].every((v) => v == null))
            const EmptyNotice(
              'Контакты ещё не опубликованы',
              'Связаться с командой можно в разделе «Сообщения».',
            ),
          if (contacts != null)
            ...['phone', 'email', 'business_hours', 'response_expectation']
                .where((k) => contacts[k] != null)
                .map(
                  (k) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: SelectableText(contacts[k]),
                  ),
                ),
          ...snapshot.data![1].map(
            (f) => ExpansionTile(
              title: Text(f['question']),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(f['answer']),
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}
