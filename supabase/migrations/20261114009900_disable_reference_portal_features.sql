-- Reference-site marketing features are outside the Kazakhstan product scope.
-- Preserve previously stored data; disable their authenticated write entry points.
revoke execute on function public.submit_portal_request(text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.client_prepare_bki_upload(uuid) from public, anon, authenticated;
