-- Unread badges query by recipient frequently; do not scan read history.
create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;
