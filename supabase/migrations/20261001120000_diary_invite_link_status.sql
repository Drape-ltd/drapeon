-- Track what the tailor actually did with a Client Passport link. A copy or
-- share-sheet handoff is not proof that a message was delivered.
ALTER TABLE public.diary_entries
  DROP CONSTRAINT IF EXISTS diary_invite_status_check;

ALTER TABLE public.diary_entries
  ADD CONSTRAINT diary_invite_status_check
    CHECK (invite_status IN (
      'NOT_INVITED',
      'LINK_COPIED',
      'LINK_SHARED',
      'INVITE_SENT', -- retained for clients running older app versions
      'CLAIMED'
    ));
