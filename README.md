# 🌈 SoMe Kids

En ekte, men rolig sosial kanal for barn, laget som det motsatte av X og Facebook:

- **Ingen likes, hjerter, stjerner, følgere eller tall.** Ingenting å konkurrere om.
- **Bare positive innlegg.** Hvert innlegg må være én av fire typer: *Noe jeg er glad for*, *Noe jeg lærte*, *En takk til noen* eller *Noe jeg laget*. Et snillfilter på serveren stopper stygge ord, telefonnumre, e-post, adresser, lenker og brukernavn fra andre apper.
- **Laget for lite bruk.** Feeden viser bare de siste tre dagene og tar slutt («Du har sett alt som er nytt!»). Det er ingen uendelig scrolling og ingen varsler. Foresatte bestemmer daglig tidsgrense (standard 20 min), åpningstider (standard 07–20) og antall innlegg per dag (standard 2). Alt dette håndheves på serveren.
- **Lukkede grupper.** Barn ser bare innlegg fra gruppene sine, for eksempel klassen eller en vennegjeng. Det finnes ingen søk, ingen profiler å bla i og ingen direktemeldinger.

## Roller

| Hvem | Kan |
|---|---|
| **Foresatt** | Registrere seg, lage og slette barnekontoer, sette grenser, lage grupper (og få en invitasjonskode), melde barna inn og ut av grupper, lese alt i gruppene barna er med i, slette barnas innlegg og slette hele kontoen sin med alle data. |
| **Gruppeeier** (foresatt som laget gruppa) | Det samme, og i tillegg se rapporterte innlegg og vise dem igjen eller fjerne dem. |
| **Barn** | Logge inn med brukernavnet og passordet den foresatte har laget, lese feeden, dele innlegg, slette egne innlegg og trykke «🚩 Si fra». Et innlegg som blir rapportert, skjules med en gang til en voksen har sett på det. |

Barn kan ikke registrere seg selv. Det er alltid en foresatt som lager kontoen, slik at det er samtykke fra foresatte (GDPR-kravet for barn under 13 år i Norge).

## Kjør lokalt

Krever Node.js 22.13 eller nyere (bruker den innebygde `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## Drift på server

```bash
docker build -t some-kids .
docker run -d -p 3000:3000 -v some-data:/data some-kids
```

Miljøvariabler:

| Variabel | Standard | Beskrivelse |
|---|---|---|
| `PORT` | `3000` | Port |
| `DB_PATH` | `data/some.db` | SQLite-databasefil (i Docker: `/data/some.db`) |
| `NODE_ENV` | – | Sett til `production` for `Secure`-cookies (krever HTTPS) |
| `TRUST_PROXY` | – | Sett hvis appen står bak en proxy/lastbalanserer, slik at riktig IP brukes |
| `TZ_APP` | `Europe/Oslo` | Tidssone for åpningstider og dagsgrenser |

Kjør alltid bak HTTPS i produksjon (for eksempel Caddy, nginx eller en plattform som Fly.io eller Render).

## Sikkerhet

- Passord hashes med scrypt. Økter ligger i en `HttpOnly`, `SameSite=Strict`-cookie, og bare en hash av øktnøkkelen lagres.
- Alle endringer krever JSON (CSRF-vern), og innlogging bremses etter 5 feil.
- Streng Content-Security-Policy. All brukertekst vises med `textContent`, aldri som HTML.
- Foresatte kan bare se og styre sine egne barn og gruppene de har tilgang til (dekket av tester).

## Tilpasning

- Ordlisten for snillfilteret: `server/filter.js`
- Innleggstyper, farger, klistremerker og dyr: øverst i `server/app.js`
- Standardgrenser: `server/db.js`
