package kz.modernsecure.app;

import java.net.URI;

/** Pure origin checks shared by navigation and authenticated downloads. */
final class NavigationPolicy {
    static boolean sameOrigin(String base, String candidate) {
        try {
            URI a = new URI(base), b = new URI(candidate);
            return b.getUserInfo() == null && a.getScheme().equalsIgnoreCase(b.getScheme())
                && a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b);
        } catch (Exception ignored) { return false; }
    }
    private static int port(URI u) { return u.getPort() >= 0 ? u.getPort() : "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80; }
    static boolean filePath(String path) {
        return path != null && path.matches("/api/(document-files|contracts|payment-receipts|message-attachments|staff-message-attachments)/[0-9a-fA-F-]{36}");
    }
}
