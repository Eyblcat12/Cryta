-- Run with the audit schema owner. Use separate LOGINs for signing and verification.
\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA public TO :"signer_role", :"verifier_role";
GRANT SELECT ON public.audit_anchor_rows TO :"signer_role", :"verifier_role";
GRANT EXECUTE ON FUNCTION public.capture_audit_anchor_rows(bigint,integer) TO :"signer_role";
COMMIT;
