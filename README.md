# SoMe

En ekte, men rolig sosial kanal for barn (laget for mellomtrinnet), og det motsatte av X og Facebook:

- **Ingen likes, hjerter, stjerner, følgere eller tall.** Ingenting å konkurrere om.
- **Bare positive innlegg.** Hvert innlegg må være én av fire typer: *Glad for*, *Lærte noe*, *Takk til* eller *Har laget*. Et snillfilter på serveren stopper stygge ord, telefonnumre, e-post, adresser, lenker og brukernavn fra andre apper.
- **Laget for lite bruk.** Feeden viser bare de siste tre dagene og tar slutt («Du har sett alt som er nytt!»). Det er ingen uendelig scrolling og ingen varsler. Foresatte bestemmer daglig tidsgrense (standard 20 min), åpningstider (standard 07–20) og antall innlegg per dag (standard 2). Alt dette håndheves på serveren.
- **Bilder og video.** Hver video kan være maks 30 sekunder og 50 MB. Grensene kan endres, se under. GPS-posisjon og annen metadata fjernes fra både bilder og video. Som standard må gruppeeieren godkjenne bilder og video før de andre barna ser dem. Videoer spiller aldri av automatisk.
- **Lukkede grupper.** Barn ser bare innlegg fra gruppene sine, for eksempel klassen eller en vennegjeng. Det finnes ingen søk, ingen profiler å bla i og ingen direktemeldinger.

## Roller

| Hvem | Kan |
|---|---|
| **Foresatt** | Registrere seg, lage og slette barnekontoer, sette grenser, lage grupper (og få en invitasjonskode), melde barna inn og ut av grupper, lese alt i gruppene barna er med i, slette barnas innlegg og slette hele kontoen sin med alle data. |
| **Gruppeeier** (foresatt som laget gruppa) | Det samme, og i tillegg godkjenne bilder og video, se rapporterte innlegg og vise dem igjen eller fjerne dem, og slå av eller på kravet om godkjenning for gruppa. |
| **Barn** | Logge inn med brukernavnet og passordet den foresatte har laget, lese feeden, dele innlegg med bilde eller video, slette egne innlegg og trykke «🚩 Si fra». Et innlegg som blir rapportert, skjules med en gang til en voksen har sett på det. |

Barn kan ikke registrere seg selv. Det er alltid en foresatt som lager kontoen, slik at det er samtykke fra foresatte (GDPR-kravet for barn under 13 år i Norge).

## Design

Rolig og moderne uttrykk med nøytrale flater, én aksentfarge og strekikoner. Lys og mørk modus følger telefonens innstilling. Nye innlegg skrives i et ark som glir opp nedenfra, og foresatte har faner for barn, grupper og konto.

## Mobil: iPhone, iPad og Android

Appen er laget for mobil først. Den har store trykkflater, støtter hakket og hjem-linja på iPhone og zoomer ikke inn når man skriver. Den er en installerbar nettapp (PWA), så den trenger ingen App Store eller Google Play:

- **iPhone/iPad (Safari):** Åpne adressen, trykk Del-knappen ⬆️ og velg «Legg til på Hjem-skjerm».
- **Android (Chrome):** Åpne adressen, trykk menyen ⋮ og velg «Legg til på startsiden» eller «Installer app».

Da åpnes SoMe som en egen app med eget ikon og uten nettleserlinjer.

### Bilder og video

- **Bilder** skaleres ned (maks 1600 px) og tegnes på nytt på telefonen før opplasting. Det fjerner EXIF/GPS og gjør HEIC-bilder fra iPhone om til JPEG. Serveren fjerner i tillegg alle metadata-segmenter.
- **Video** må være MP4 eller MOV, som er det iPhone og Android tar opp i. Lengden sjekkes på telefonen før opplasting og kontrolleres på nytt på serveren. Er en video for lang, får barnet beskjed om å klippe den i Bilder-appen. Metadata-boksene i videofila (der GPS-posisjonen ligger) nulles ut på serveren.
- Bare de som har tilgang til innlegget kan hente fila. Opplastinger som ikke blir delt, og filer fra slettede innlegg, ryddes bort automatisk.
- En iPhone med «Høy effektivitet» filmer i HEVC. Safari gjør vanligvis om videoen til H.264 når den lastes opp fra nettleseren, men enkelte eldre Android-telefoner kan ha problemer med å spille HEVC.

## Kjør lokalt

Krever Node.js 22.13 eller nyere (bruker den innebygde `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## Drift på Render

Repoet har en ferdig `render.yaml`:

1. Logg inn på [dashboard.render.com](https://dashboard.render.com) og velg **New → Blueprint**.
2. Koble til GitHub og velg repoet `KASA-INC/SoMe` og grenen med koden. Hvis repoet ikke vises, må Render få tilgang til organisasjonen KASA-INC i GitHub.
3. Render leser `render.yaml` og ber deg fylle inn **REGISTRATION_CODE**. Velg en kode som du gir til foresatte som skal teste.
4. Trykk **Apply**. Etter noen minutter får du en adresse som `https://some-kids.onrender.com`.

Tjenesten bruker planen *Starter* med en disk på 1 GB i Frankfurt (EU), fordi databasen og bildene må overleve omstarter. Gratisplanen har ikke disk. Render tar daglige øyeblikksbilder av disken. Nye endringer på grenen publiseres automatisk.

## Drift på annen server

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
| `MEDIA_DIR` | `data/media` | Mappe for opplastede bilder og videoer (i Docker: `/data/media`) |
| `MAX_VIDEO_SECONDS` | `30` | Maks lengde per video i sekunder |
| `MAX_VIDEO_MB` | `50` | Maks størrelse per video i MB |
| `MAX_IMAGE_MB` | `8` | Maks størrelse per bilde i MB |
| `REGISTRATION_CODE` | – | Hvis satt, må foresatte oppgi denne koden for å lage konto |

Hvis det står en proxy foran appen (for eksempel nginx), må den tillate store nok opplastinger, f.eks. `client_max_body_size 55m;`.

Kjør alltid bak HTTPS i produksjon (for eksempel Caddy, nginx eller en plattform som Fly.io eller Render).

## Sikkerhet

- Passord hashes med scrypt. Økter ligger i en `HttpOnly`, `SameSite=Strict`-cookie, og bare en hash av øktnøkkelen lagres.
- Alle endringer krever JSON (CSRF-vern), og innlogging bremses etter 5 feil.
- Streng Content-Security-Policy. All brukertekst vises med `textContent`, aldri som HTML.
- Foresatte kan bare se og styre sine egne barn og gruppene de har tilgang til (dekket av tester).

## Tilpasning

- Ordlisten for snillfilteret: `server/filter.js`
- Innleggstyper, bakgrunner, emojier og profilbilder: øverst i `server/app.js`
- Farger og utseende: variablene øverst i `public/style.css` (egne verdier for mørk modus)
- Standardgrenser: `server/db.js`
