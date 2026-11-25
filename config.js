// Public configuration only. The publishable key is designed to be public;
// all protection is enforced in the database (RLS + checked RPCs).
window.OCQ_CONFIG = {
  supabaseUrl: "https://tlqeaqibwuvszwwfvncp.supabase.co",   // V5 development project
  publishableKey: "sb_publishable_SlmrUYO4D6h_nuZbwmOcKQ_VNBZpRyU",
  environmentLabel: "V5 development – synthetic data only",
  lineProvider: "custom:line",
  safetyRefreshSeconds: 60,
  overviewRefreshSeconds: 45,
  features: { scanners: true, printers: true }   // switched on when Stage 2 / Stage 3 are live
};
