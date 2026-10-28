import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'config.dart';
import 'data.dart';
import 'ui.dart';
import 'workspace.dart';

final clientNavigator = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('ru');
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  try {
    await Supabase.initialize(
      url: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabaseKey,
      authOptions: const FlutterAuthClientOptions(
        localStorage: SecureSessionStorage(),
      ),
    );
    runApp(const ClientApp());
  } catch (_) {
    runApp(
      MaterialApp(
        theme: clientTheme(),
        home: const Scaffold(
          body: Center(
            child: EmptyNotice(
              'Не удалось запустить приложение',
              'Проверьте подключение к интернету и откройте приложение снова.',
            ),
          ),
        ),
      ),
    );
  }
}

class ClientApp extends StatelessWidget {
  const ClientApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: clientNavigator,
    title: 'Современная защита',
    debugShowCheckedModeBanner: false,
    theme: clientTheme(),
    home: const AuthGate(),
  );
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});
  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final db = Supabase.instance.client;
  StreamSubscription<AuthState>? subscription;
  bool recovery = false;
  @override
  void initState() {
    super.initState();
    subscription = db.auth.onAuthStateChange.listen((state) {
      if (!mounted) return;
      if (state.event == AuthChangeEvent.signedOut) {
        clientNavigator.currentState?.popUntil((route) => route.isFirst);
      }
      setState(() {
        recovery =
            state.event == AuthChangeEvent.passwordRecovery ||
            (recovery && state.event != AuthChangeEvent.signedOut);
      });
    });
  }

  @override
  void dispose() {
    subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => db.auth.currentSession == null
      ? const LoginScreen()
      : recovery
      ? PasswordScreen(onDone: () => setState(() => recovery = false))
      : Workspace(
          key: ValueKey(db.auth.currentUser!.id),
          repository: ClientRepository(db),
        );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController(), password = TextEditingController();
  final form = GlobalKey<FormState>();
  bool hidden = true, busy = false;
  String? error;
  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> login() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await Supabase.instance.client.auth.signInWithPassword(
        email: email.text.trim(),
        password: password.text,
      );
    } on AuthException catch (e) {
      if (mounted) {
        setState(
          () => error = e.code == 'invalid_credentials'
              ? 'Проверьте email и пароль.'
              : e.code == 'email_not_confirmed'
              ? 'Подтвердите email по ссылке в письме.'
              : 'Не удалось войти. Попробуйте ещё раз позже.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'Нет связи с сервером. Проверьте интернет и повторите вход.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Stack(
      children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFE1EDF6),
                  Color(0xFFF7FAFD),
                  Color(0xFFD7E7F3),
                ],
              ),
            ),
          ),
        ),
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          height: 260,
          child: ShaderMask(
            shaderCallback: (rect) => const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.transparent, Colors.white],
            ).createShader(rect),
            blendMode: BlendMode.dstIn,
            child: Image.asset(
              'assets/architecture.jpg',
              fit: BoxFit.cover,
              color: const Color(0xFFD7E3EB),
              colorBlendMode: BlendMode.screen,
            ),
          ),
        ),
        SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: 420,
                    minHeight: constraints.maxHeight,
                  ),
                  child: IntrinsicHeight(
                    child: Form(
                      key: form,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 62),
                          const Center(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.shield_rounded,
                                    size: 58,
                                    color: Color(0xFF07375B),
                                  ),
                                  SizedBox(width: 10),
                                  Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'СОВРЕМЕННАЯ\nЗАЩИТА',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 19,
                                          height: 1.1,
                                          color: ink,
                                        ),
                                      ),
                                      SizedBox(height: 6),
                                      Text(
                                        'ЮРИДИЧЕСКАЯ КОМПАНИЯ',
                                        style: TextStyle(
                                          fontSize: 8,
                                          letterSpacing: 1.2,
                                          color: ink,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 46),
                          Text(
                            'Добро пожаловать',
                            style: Theme.of(context).textTheme.headlineMedium,
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Войдите в личный кабинет,\nчтобы работать с вашим делом',
                            style: TextStyle(
                              color: muted,
                              height: 1.5,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 24),
                          TextFormField(
                            controller: email,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email],
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              hintText: 'Электронная почта',
                              prefixIcon: Icon(Icons.mail_outline_rounded),
                            ),
                            validator: (v) =>
                                v != null &&
                                    RegExp(
                                      r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                                    ).hasMatch(v.trim())
                                ? null
                                : 'Введите email',
                          ),
                          const SizedBox(height: 10),
                          TextFormField(
                            controller: password,
                            obscureText: hidden,
                            autofillHints: const [AutofillHints.password],
                            onFieldSubmitted: (_) => busy ? null : login(),
                            decoration: InputDecoration(
                              hintText: 'Пароль',
                              prefixIcon: const Icon(
                                Icons.lock_outline_rounded,
                              ),
                              suffixIcon: IconButton(
                                tooltip: hidden
                                    ? 'Показать пароль'
                                    : 'Скрыть пароль',
                                onPressed: () =>
                                    setState(() => hidden = !hidden),
                                icon: Icon(
                                  hidden
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                            validator: (v) =>
                                (v ?? '').isEmpty ? 'Введите пароль' : null,
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const RecoveryScreen(),
                                ),
                              ),
                              child: const Text('Забыли пароль?'),
                            ),
                          ),
                          if (error != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 14),
                              child: Text(
                                error!,
                                style: const TextStyle(
                                  color: Color(0xFFAD3028),
                                ),
                              ),
                            ),
                          const SizedBox(height: 8),
                          PrimaryButton('Войти', busy: busy, onPressed: login),
                          const Spacer(),
                          const Padding(
                            padding: EdgeInsets.only(top: 64, bottom: 30),
                            child: Center(
                              child: Text(
                                'Надёжная правовая\nподдержка в Казахстане',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: ink, height: 1.4),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class RecoveryScreen extends StatefulWidget {
  const RecoveryScreen({super.key});
  @override
  State<RecoveryScreen> createState() => _RecoveryScreenState();
}

class _RecoveryScreenState extends State<RecoveryScreen> {
  final email = TextEditingController();
  bool busy = false;
  @override
  void dispose() {
    email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Восстановление доступа')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          'Укажите email вашего клиентского аккаунта. Мы отправим ссылку для смены пароля.',
        ),
        const SizedBox(height: 24),
        TextField(
          controller: email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        const SizedBox(height: 20),
        PrimaryButton(
          'Отправить ссылку',
          busy: busy,
          onPressed: () async {
            if (!RegExp(
              r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
            ).hasMatch(email.text.trim())) {
              notify(context, 'Введите корректный email.');
              return;
            }
            setState(() => busy = true);
            try {
              await Supabase.instance.client.auth.resetPasswordForEmail(
                email.text.trim(),
                redirectTo: 'kz.modernsecure.client://auth/recovery',
              );
              if (context.mounted) {
                notify(
                  context,
                  'Если аккаунт существует, письмо отправлено. Проверьте почту.',
                );
              }
            } catch (_) {
              if (context.mounted) {
                notify(
                  context,
                  'Не удалось отправить письмо. Повторите позже.',
                );
              }
            } finally {
              if (mounted) setState(() => busy = false);
            }
          },
        ),
      ],
    ),
  );
}

class PasswordScreen extends StatefulWidget {
  const PasswordScreen({super.key, required this.onDone});
  final VoidCallback onDone;
  @override
  State<PasswordScreen> createState() => _PasswordScreenState();
}

class _PasswordScreenState extends State<PasswordScreen> {
  final password = TextEditingController(), repeat = TextEditingController();
  bool busy = false;
  @override
  void dispose() {
    password.dispose();
    repeat.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Новый пароль')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        TextField(
          controller: password,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Новый пароль'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: repeat,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Повторите пароль'),
        ),
        const SizedBox(height: 20),
        PrimaryButton(
          'Сохранить пароль',
          busy: busy,
          onPressed: () async {
            if (password.text.length < 8 ||
                password.text.length > 72 ||
                password.text != repeat.text) {
              notify(
                context,
                'Пароли должны совпадать и содержать от 8 до 72 символов.',
              );
              return;
            }
            setState(() => busy = true);
            try {
              await Supabase.instance.client.auth.updateUser(
                UserAttributes(password: password.text),
              );
              widget.onDone();
            } catch (_) {
              if (context.mounted) {
                notify(
                  context,
                  'Не удалось изменить пароль. Запросите новую ссылку.',
                );
              }
            } finally {
              if (mounted) setState(() => busy = false);
            }
          },
        ),
      ],
    ),
  );
}
