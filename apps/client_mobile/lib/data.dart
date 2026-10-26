import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

typedef JsonRow = Map<String, dynamic>;
List<JsonRow> rows(dynamic value) => (value as List).cast<JsonRow>();

class SecureSessionStorage extends LocalStorage {
  const SecureSessionStorage();
  static const _storage = FlutterSecureStorage();
  static const _key = 'modernsecure.dukqvwqxgwyadffmdeee.session';
  @override
  Future<void> initialize() async {}
  @override
  Future<bool> hasAccessToken() => _storage.containsKey(key: _key);
  @override
  Future<String?> accessToken() => _storage.read(key: _key);
  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _key, value: persistSessionString);
  @override
  Future<void> removePersistedSession() => _storage.delete(key: _key);
}

class ClientRepository {
  ClientRepository(this.db);
  final SupabaseClient db;
  String get userId => db.auth.currentUser!.id;

  Future<JsonRow> loadIdentity() async {
    final staff = await db.rpc('staff_mfa_status');
    if (staff is Map && staff['active'] == true) {
      await db.auth.signOut();
      throw const ClientAccessException(
        'Войдите под клиентским аккаунтом. Учётные записи сотрудников здесь не используются.',
      );
    }
    final client = await db
        .from('clients')
        .select()
        .eq('user_id', userId)
        .maybeSingle();
    if (client == null) {
      throw const ClientAccessException(
        'Аккаунт пока не связан с карточкой клиента. Обратитесь в компанию для подключения.',
      );
    }
    return client;
  }

  Future<List<JsonRow>> cases() async => rows(
    await db.from('cases').select().order('created_at', ascending: false),
  );

  Future<CaseData> loadCase(JsonRow item) async {
    final id = item['id'] as String;
    final result = await Future.wait([
      db
          .from('stage_templates')
          .select()
          .eq('version_id', item['service_version_id'])
          .order('position'),
      db
          .from('case_stage_events')
          .select()
          .eq('case_id', id)
          .order('occurred_at'),
      db
          .from('document_requests')
          .select('*, document_files(*)')
          .eq('case_id', id)
          .order('created_at'),
      db.from('tasks').select().eq('case_id', id).order('created_at'),
      db.from('payment_schedule').select().eq('case_id', id).order('due_on'),
      db.from('payments').select().eq('case_id', id).eq('status', 'confirmed'),
      db
          .from('contracts')
          .select()
          .eq('case_id', id)
          .order('version_no', ascending: false),
    ]);
    return CaseData(
      item,
      rows(result[0]),
      rows(result[1]),
      rows(result[2]),
      rows(result[3]),
      rows(result[4]),
      rows(result[5]),
      rows(result[6]),
    );
  }

  Future<List<JsonRow>> messages(String caseId, {JsonRow? before}) async =>
      rows(
        await db.rpc(
          'case_message_page',
          params: {
            'p_case_id': caseId,
            'p_before_created_at': before?['created_at'],
            'p_before_id': before?['id'],
            'p_limit': 50,
          },
        ),
      );
  Future<void> send(String caseId, String body, String key) async {
    await db.rpc(
      'post_case_message',
      params: {'p_case_id': caseId, 'p_body': body, 'p_idempotency_key': key},
    );
  }
}

class ClientAccessException implements Exception {
  const ClientAccessException(this.message);
  final String message;
}

class CaseData {
  CaseData(
    this.item,
    this.stages,
    this.events,
    this.documents,
    this.tasks,
    this.schedule,
    this.payments,
    this.contracts,
  );
  final JsonRow item;
  final List<JsonRow> stages,
      events,
      documents,
      tasks,
      schedule,
      payments,
      contracts;
  String get id => item['id'] as String;
  JsonRow? get stage =>
      stages.where((s) => s['id'] == item['current_stage_id']).firstOrNull;
  bool get writable => item['status'] == 'open' && item['is_suspended'] != true;
  double outstanding(JsonRow installment) {
    final paid = payments
        .where((p) => p['schedule_id'] == installment['id'])
        .fold<double>(0, (sum, p) => sum + (p['amount_kzt'] as num).toDouble());
    return ((installment['amount_kzt'] as num).toDouble() - paid).clamp(
      0,
      double.infinity,
    );
  }
}

String documentStatus(JsonRow request) {
  if (request['status'] != 'active') return 'Не требуется';
  final files = rows(request['document_files'] ?? []);
  if (files.isEmpty) return 'Нужно загрузить';
  final version = files
      .map((f) => f['version_no'] as int)
      .reduce((a, b) => a > b ? a : b);
  final latest = files.where((f) => f['version_no'] == version).toList();
  if (latest.any((f) => f['status'] == 'returned')) return 'Нужны исправления';
  if (latest.any((f) => f['status'] == 'quarantine')) {
    return 'Проверка безопасности';
  }
  if (latest.any((f) => f['status'] == 'under_review')) return 'На проверке';
  if (latest.every((f) => f['status'] == 'accepted')) return 'Принят';
  return 'Нужно загрузить';
}
