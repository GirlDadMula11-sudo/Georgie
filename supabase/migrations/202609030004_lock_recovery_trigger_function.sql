-- Trigger-only function; no direct caller requires execution authority.
revoke all on function public.georgie_recovery_receipts_immutable() from public, anon, authenticated;
