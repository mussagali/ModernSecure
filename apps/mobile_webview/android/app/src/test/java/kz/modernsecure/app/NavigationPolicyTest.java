package kz.modernsecure.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
    @Test public void cookiesStayOnExactOrigin() {
        assertTrue(NavigationPolicy.sameOrigin("https://site.test", "https://site.test:443/account"));
        for(String url : new String[]{"https://site.test.evil.test", "http://site.test", "https://site.test:444", "https://a@site.test", "javascript:alert(1)", "//site.test"})
            assertFalse(url, NavigationPolicy.sameOrigin("https://site.test", url));
    }
}
