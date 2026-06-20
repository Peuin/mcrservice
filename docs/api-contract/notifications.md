# Notifications API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/notifications` | Paginated notification inbox and unread count |
| PATCH | `/api/v1/notifications/:notificationId/read` | Mark one owned notification as read |
| PATCH | `/api/v1/notifications/read-all` | Mark the current user's inbox as read |
| PATCH | `/api/v1/notifications/:notificationId/mute` | Mute the notification type represented by one notification |
| DELETE | `/api/v1/notifications/:notificationId` | Delete one owned notification |
| POST | `/api/v1/notification-devices/push-tokens` | Register a device push token |
| DELETE | `/api/v1/notification-devices/push-tokens` | Unregister a device push token |
| POST | `/internal/workers/notification-push` | Send FCM for one notification; server secret only |

The existing `/notifications` route remains a hidden compatibility alias for Flutter.
