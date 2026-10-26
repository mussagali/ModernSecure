// SQL-only role tests simulate AAL2 inside an always-rolled-back transaction.
// Real enrollment and challenge are tested separately with Supabase Auth.
export async function simulateMfaInTransaction(db, userId) {
  await db.query(`insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret)
    values(gen_random_uuid(),$1,'totp','verified',now(),now(),'JBSWY3DPEHPK3PXP')`,[userId]);
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',aal:'aal2'})]);
}
