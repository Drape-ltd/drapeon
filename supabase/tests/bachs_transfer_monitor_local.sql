create table payout_claims (id uuid primary key, source_id uuid not null, provider text not null, status text not null, operation_created_at timestamptz not null);
create table ops_issues (id bigserial primary key, dedupe_key text not null unique, status text not null);
create table ops_audit_logs (id bigserial primary key, issue_id bigint not null references ops_issues(id), action text not null);
create table ops_messages (id bigserial primary key, issue_id bigint not null references ops_issues(id), kind text not null);

create function queue_ops_issue_message() returns trigger language plpgsql as $$
begin
  if new.action in ('ISSUE_CREATED', 'ISSUE_AUTO_RESOLVED') then
    insert into ops_messages(issue_id, kind) values (new.issue_id, new.action);
  end if;
  return new;
end $$;
create trigger ops_issue_message after insert on ops_audit_logs for each row execute function queue_ops_issue_message();

insert into payout_claims(id, source_id, provider, status, operation_created_at)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'BACHS', 'PROVIDER_PENDING', now() - interval '25 hours');
