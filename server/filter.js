// Snillfilter: stopper stygge ord og personopplysninger før noe lagres.
// Utvid BAD_WORDS etter behov. Ord matches på starten av et ord, så "dum" stopper også "dumme".

export const BAD_WORDS = [
  "dum", "idiot", "stygg", "hater", "tjukk", "feit", "teit", "drit", "faen", "jævl",
  "helvete", "kjeft", "loser", "taper", "suger", "ekkel", "kødd", "mobb", "drep", "sex",
];

const WORD_START = "(^|[^a-zæøå])";

export function checkText(text) {
  if (BAD_WORDS.some((w) => new RegExp(WORD_START + w, "i").test(text))) {
    return "Det ser ut som et ord som ikke er så snilt. Prøv å si det på en snillere måte 💛";
  }
  if (/\d[\d\s.-]{6,}\d/.test(text)) {
    return "Det ser ut som et telefonnummer. Telefonnummer skal ikke deles på nett 📵";
  }
  if (/\S+@\S+\.\S+/.test(text)) {
    return "Det ser ut som en e-postadresse. Den skal du holde hemmelig 🤫";
  }
  if (/(gate|gata|vei|veien|veg|vegen|plass)\s*\d+/i.test(text)) {
    return "Det ser ut som en adresse. Hvor du bor er hemmelig på nett 🏠";
  }
  if (/https?:\/\/|www\.|\.(com|no|net|org)\b/i.test(text)) {
    return "Lenker er ikke lov her. Spør en voksen hvis du vil vise noe 🔗";
  }
  if (/snap|tiktok|insta|discord|whatsapp/i.test(text)) {
    return "Her deler vi ikke brukernavn fra andre apper 🙂";
  }
  if (text.length >= 12 && text === text.toUpperCase() && /[A-ZÆØÅ]/.test(text)) {
    return "Bare store bokstaver ser ut som roping. Prøv med små bokstaver 🙂";
  }
  return null;
}
