// Navnet på tjenesten, brukt i meldinger og e-post. (Klienten har sitt i public/brand.js.)
export const APP_NAME = "quipu";

// Kontaktadressen som vises til foresatte (informasjonssiden og e-poster).
export const CONTACT_EMAIL = "hei@quipu.no";

// Adressen appen ligger på, brukt i lenker som sendes på e-post.
// Settes med APP_URL. På Render settes RENDER_EXTERNAL_URL automatisk.
// Vi bruker aldri Host-headeren fra forespørselen, siden den kan forfalskes.
export function appUrl(env = process.env) {
  return env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${Number(env.PORT) || 3000}`;
}
