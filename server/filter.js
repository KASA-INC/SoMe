// Snillfilter: stopper stygge ord og personopplysninger før noe lagres.
// Utvid BAD_WORDS etter behov. Ord matches på starten av et ord, så "dum" stopper også "dumme".

export const BAD_WORDS = [
  "dum", "idiot", "stygg", "hater", "tjukk", "feit", "teit", "drit", "faen", "jævl",
  "helvete", "kjeft", "loser", "taper", "suger", "ekkel", "kødd", "mobb", "drep", "sex",
];

const WORD_START = "(^|[^a-zæøå])";

export function checkText(text) {
  if (BAD_WORDS.some((w) => new RegExp(WORD_START + w, "i").test(text))) {
    return "Dette ser ut til å inneholde et ord som kan såre noen. Prøv å skrive det på en annen måte.";
  }
  if (/\d[\d\s.-]{6,}\d/.test(text)) {
    return "Det ser ut som et telefonnummer. Telefonnummer deler vi ikke her.";
  }
  if (/\S+@\S+\.\S+/.test(text)) {
    return "Det ser ut som en e-postadresse. E-post deler vi ikke her.";
  }
  if (/(gate|gata|vei|veien|veg|vegen|plass)\s*\d+/i.test(text)) {
    return "Det ser ut som en adresse. Hvor du bor, deler vi ikke her.";
  }
  if (/https?:\/\/|www\.|\.(com|no|net|org)\b/i.test(text)) {
    return "Lenker kan ikke deles her.";
  }
  if (/snap|tiktok|insta|discord|whatsapp/i.test(text)) {
    return "Brukernavn fra andre apper kan ikke deles her.";
  }
  if (text.length >= 12 && text === text.toUpperCase() && /[A-ZÆØÅ]/.test(text)) {
    return "Bare store bokstaver leses som roping. Prøv med små bokstaver.";
  }
  return null;
}
