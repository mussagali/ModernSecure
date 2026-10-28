package kz.modernsecure.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class PushService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        // The authenticated web bridge binds the current token on the next
        // workspace visit; a background service never stores web credentials.
        getSharedPreferences("push", MODE_PRIVATE).edit().putBoolean("tokenChanged", true).apply();
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        if(!getSharedPreferences("push", MODE_PRIVATE).getBoolean("enabled", false)) return;
        String id = message.getData().get("notificationId");
        if(id == null || !id.matches("[0-9a-fA-F-]{36}")) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("updates", "Обновления в кабинете", NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent = new Intent(this, MainActivity.class).putExtra("notificationId", id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(this, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "updates")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("Современная защита")
            .setContentText("В вашем кабинете есть обновление")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).build();
        manager.notify(id.hashCode(), notification);
    }
}
