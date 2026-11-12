// Static SQL, shared by enqueue, read projection and the pre-SMTP permission check.
// The surrounding query supplies aliases a (asset) and u (active recipient).
export const ASSET_ALERT_RECIPIENT = `(u.id=a.owner_id OR EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles role ON role.id=ur.role_id WHERE ur.user_id=u.id AND role.code='ADMIN'
) OR EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles role ON role.id=ur.role_id JOIN approver_scopes scope ON scope.user_id=ur.user_id
  WHERE ur.user_id=u.id AND role.code='APPROVER' AND scope.department_id=a.department_id
))`;
