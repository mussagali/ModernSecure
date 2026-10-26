import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:modernsecure_client/data.dart';
import 'package:modernsecure_client/main.dart';
import 'package:modernsecure_client/ui.dart';
import 'package:modernsecure_client/workspace.dart';

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  test(
    'document status uses latest version, including returned/quarantine',
    () {
      final request = <String, dynamic>{
        'status': 'active',
        'document_files': [
          {'version_no': 1, 'status': 'accepted'},
          {'version_no': 2, 'status': 'returned'},
        ],
      };
      expect(documentStatus(request), 'Нужны исправления');
      request['document_files'] = [
        {'version_no': 3, 'status': 'quarantine'},
      ];
      expect(documentStatus(request), 'Проверка безопасности');
      request['status'] = 'cancelled';
      expect(documentStatus(request), 'Не требуется');
    },
  );
  test('partial payments reduce remaining balance without going negative', () {
    final data = CaseData({}, [], [], [], [], [], [
      {'schedule_id': 'a', 'amount_kzt': 150},
      {'schedule_id': 'b', 'amount_kzt': 999},
    ], []);
    expect(data.outstanding({'id': 'a', 'amount_kzt': 400}), 250);
    expect(data.outstanding({'id': 'a', 'amount_kzt': 100}), 0);
  });
  testWidgets('login fits small phone with large text and validates locally', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: clientTheme(),
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(360, 740),
            textScaler: TextScaler.linear(1.3),
          ),
          child: const LoginScreen(),
        ),
      ),
    );
    await tester.ensureVisible(find.text('Войти'));
    await tester.tap(find.text('Войти'));
    await tester.pump();
    expect(find.text('Введите email'), findsOneWidget);
    expect(find.text('Введите пароль'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('timeline does not label unvisited earlier stages complete', (
    tester,
  ) async {
    final data = CaseData(
      {'current_stage_id': 'b'},
      [
        {'id': 'a', 'title': 'Первый этап', 'client_description': 'Описание'},
        {
          'id': 'b',
          'title': 'Текущий этап дела',
          'client_description': 'Описание',
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: clientTheme(),
        home: Scaffold(body: TimelineScreen(data: data)),
      ),
    );
    expect(find.byIcon(Icons.check), findsNothing);
    expect(find.text('Текущий этап'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
