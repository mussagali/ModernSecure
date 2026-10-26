const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const MESSAGE_PATH_PATTERN = `^(messages|staff-messages)/${uuid}/${uuid}/${uuid}/${uuid}$`;
const exactPath = new RegExp(MESSAGE_PATH_PATTERN);

export function isMessagePath(path) {
  return exactPath.test(path);
}

export const CANDIDATE_SQL = `
  select obj.name from storage.objects obj
  where obj.bucket_id = $1 and obj.name ~ $2
    and obj.created_at < clock_timestamp() - interval '24 hours'
    and not exists (
      select 1 from public.message_attachments ma where ma.storage_path = obj.name
    )
    and not exists (
      select 1 from public.staff_message_attachments sma where sma.storage_path = obj.name
    )
  order by obj.created_at, obj.name
  limit 100
`;

export const RECHECK_SQL = `
  select 1 from storage.objects obj
  where obj.bucket_id = $1 and obj.name = $2 and obj.name ~ $3
    and obj.created_at < clock_timestamp() - interval '24 hours'
    and not exists (
      select 1 from public.message_attachments ma where ma.storage_path = obj.name
    )
    and not exists (
      select 1 from public.staff_message_attachments sma where sma.storage_path = obj.name
    )
`;
