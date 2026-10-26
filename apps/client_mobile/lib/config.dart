// Public project configuration. Never add a service-role key to this application.
abstract final class AppConfig {
  static const supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://dukqvwqxgwyadffmdeee.supabase.co',
  );
  static const supabaseKey = String.fromEnvironment(
    'SUPABASE_PUBLISHABLE_KEY',
    defaultValue: 'sb_publishable_NyptwNbQ77oH9h2Gh93TfA_dzDBI8HN',
  );
}
