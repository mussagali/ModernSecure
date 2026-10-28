// Local layout fixtures only; these values are never bundled as application data.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:modernsecure_client/data.dart';
import 'package:modernsecure_client/main.dart';
import 'package:modernsecure_client/ui.dart';
import 'package:modernsecure_client/workspace.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('ru');
    final fonts = FontLoader('ClientRoboto')
      ..addFont(rootBundle.load('assets/fonts/roboto-regular.ttf'))
      ..addFont(rootBundle.load('assets/fonts/roboto-bold.ttf'));
    await fonts.load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  final data = CaseData(
    {
      'id': 'fixture',
      'status': 'open',
      'title': 'Банкротство физического лица',
      'current_stage_id': 'collect',
    },
    [
      {
        'id': 'opened',
        'title': 'Дело открыто',
        'client_description': 'Подписан договор, сформировано дело',
      },
      {
        'id': 'collect',
        'title': 'Сбор документов',
        'client_description': 'Ожидаем от вас документы по списку',
      },
      {
        'id': 'check',
        'title': 'Проверка документов',
        'client_description': 'После сбора всех документов',
      },
      {
        'id': 'prepare',
        'title': 'Подготовка заявления',
        'client_description': 'После проверки документов',
      },
      {
        'id': 'court',
        'title': 'Рассмотрение в суде',
        'client_description': 'Ожидаем решение суда',
      },
      {
        'id': 'done',
        'title': 'Завершение дела',
        'client_description': 'После получения решения',
      },
    ],
    [
      {
        'to_stage_id': 'opened',
        'occurred_at': '2026-09-12',
        'client_note': 'Дело открыто',
      },
    ],
    [
      {
        'title': 'Выписка из банка',
        'instructions': 'Нужна выписка за последние 12 месяцев в формате PDF.',
        'status': 'active',
        'document_files': [],
      },
      {
        'title': 'Справка о доходах',
        'status': 'active',
        'document_files': [
          {'version_no': 1, 'status': 'under_review'},
        ],
      },
      {
        'title': 'Копия удостоверения',
        'status': 'active',
        'document_files': [
          {'version_no': 1, 'status': 'accepted'},
        ],
      },
      {
        'title': 'Справка о семейном положении',
        'status': 'active',
        'document_files': [],
      },
    ],
    [],
    [
      {'id': 'payment', 'amount_kzt': 400000, 'due_on': '2026-10-15'},
    ],
    [],
    [],
  );
  for (final screen in ['login', 'home', 'case', 'documents', 'more']) {
    testWidgets('render $screen', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final Widget content = switch (screen) {
        'login' => const LoginScreen(),
        'home' => HomeScreen(
          data: data,
          onDocuments: () {},
          onCase: () {},
          onChat: () {},
        ),
        'case' => TimelineScreen(data: data),
        'documents' => DocumentsScreen(data: data),
        _ => MoreScreen(
          repo: ClientRepository(
            SupabaseClient(
              'https://example.supabase.co',
              'fixture-only',
              authOptions: const AuthClientOptions(autoRefreshToken: false),
            ),
          ),
          identity: {
            'full_name': 'Айдар Мусагали',
            'email': 'fixture@example.com',
          },
          data: data,
        ),
      };
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: clientTheme(),
          home: screen == 'login'
              ? content
              : Scaffold(
                  appBar: AppBar(
                    title: Text(
                      {
                        'home': 'Добрый день, Айдар',
                        'case': 'Моё дело',
                        'documents': 'Документы',
                        'more': 'Ещё',
                      }[screen]!,
                    ),
                  ),
                  body: screen == 'more'
                      ? content
                      : ListView(
                          padding: const EdgeInsets.all(16),
                          children: [content],
                        ),
                  bottomNavigationBar: NavigationBar(
                    destinations: const [
                      NavigationDestination(
                        icon: Icon(Icons.home_outlined),
                        label: 'Главная',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.work_outline),
                        label: 'Дело',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.description_outlined),
                        label: 'Документы',
                      ),
                      NavigationDestination(
                        icon: Icon(Icons.chat_bubble_outline),
                        label: 'Сообщения',
                      ),
                    ],
                  ),
                ),
        ),
      );
      await tester.runAsync(() async {
        final context = tester.element(find.byType(MaterialApp));
        await precacheImage(
          const AssetImage('assets/architecture.jpg'),
          context,
        );
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/flutter-$screen.png'),
      );
    });
  }
}
