package com.hunterhz.studyos;

import android.service.notification.NotificationListenerService;

/**
 * Anchor for Android's "Notification access" permission. Android only lets an app read OTHER apps'
 * active media sessions (what is playing, play/pause/next) if the user has enabled a notification
 * listener for it. This service is deliberately empty: it does not read, store or forward any
 * notification. Its only job is to exist so MediaSessionManager.getActiveSessions() is allowed.
 */
public class StudyOSNotificationListener extends NotificationListenerService {
    static volatile boolean connected = false;

    @Override
    public void onListenerConnected() {
        connected = true;
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
    }
}
