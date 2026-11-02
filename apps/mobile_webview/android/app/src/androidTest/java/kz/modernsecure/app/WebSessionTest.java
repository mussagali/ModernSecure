package kz.modernsecure.app;

import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class WebSessionTest {
    private WebView web(View view) {
        if (view instanceof WebView) return (WebView)view;
        if(view instanceof ViewGroup) for(int i=0;i<((ViewGroup)view).getChildCount();i++) {
            WebView found=web(((ViewGroup)view).getChildAt(i)); if(found!=null)return found;
        }
        return null;
    }
    private String evaluate(ActivityScenario<MainActivity> scenario,String js) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(a -> web(a.getWindow().getDecorView()).evaluateJavascript(js,value->{result.set(value);latch.countDown();}));
        assertTrue("WebView callback",latch.await(5,TimeUnit.SECONDS));return result.get();
    }
    private void waitFor(ActivityScenario<MainActivity> scenario,String expression) throws Exception {
        long until=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<until) { if("true".equals(evaluate(scenario,expression)))return;Thread.sleep(250); }
        fail("WebView state did not arrive: "+expression);
    }
    @Test public void pendingAccountLoginAndPersistentSession() throws Exception {
        var args=InstrumentationRegistry.getArguments();
        String email=args.getString("qaEmail"),password=args.getString("qaPassword");
        assertNotNull("Pass the temporary QA account",email);assertNotNull(password);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario,"!!document.querySelector('input[name=email]')");
            String fill="document.querySelector('input[name=email]').value="+JSONObject.quote(email)+";document.querySelector('input[name=password]').value="+JSONObject.quote(password)+";document.querySelector('form').requestSubmit();";
            evaluate(scenario,fill);
            waitFor(scenario,"location.pathname==='/awaiting-approval' && document.body.innerText.includes('Ожидаем активацию')");
            scenario.recreate();
            waitFor(scenario,"location.pathname==='/awaiting-approval' && document.body.innerText.includes('Ожидаем активацию')");
            scenario.onActivity(a->web(a.getWindow().getDecorView()).loadUrl(BuildConfig.SITE_URL+"/account/profile"));
            waitFor(scenario,"location.pathname==='/awaiting-approval'");
            assertEquals("false",evaluate(scenario,"!!document.querySelector('.client-app')"));
        }
    }
}
