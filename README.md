# quipu

*(Arbeidsnavn i koden: SoMe. Navn og logo ligger i `public/brand.js` og `server/config.js`.)*

En ekte, men rolig sosial kanal for barn (laget for mellomtrinnet), og det motsatte av X og Facebook:

- **Ingen likes, hjerter, stjerner, følgere eller tall.** Ingenting å konkurrere om.
- **Vennlige innlegg.** Barna kan skrive fritt, stille spørsmål og dele tips. De kan sette en valgfri merkelapp på innlegget: *Glad for*, *Lærte noe*, *Takk til*, *Har laget*, *Spørsmål*, *Tips*, *Gleder meg til* eller *Har opplevd*. Et snillfilter på serveren stopper stygge ord, telefonnumre, e-post, adresser, lenker og brukernavn fra andre apper.
- **Laget for lite bruk.** Feeden viser bare de siste tre dagene og tar slutt («Du har sett alt som er nytt!»). Det er ingen uendelig scrolling og ingen varsler. Foresatte bestemmer daglig tidsgrense (standard 20 min), åpningstider (standard 07–20) og antall innlegg per dag (standard 5, 0–10). Ubrukte innlegg fra i går kan brukes dagen etter, men aldri mer enn dobbelt så mange som dagsgrensen på én dag. Alt dette håndheves på serveren.
- **Bilder og video.** Hver video kan være maks 30 sekunder og 50 MB. Grensene kan endres, se under. GPS-posisjon og annen metadata fjernes fra både bilder og video. Som standard må gruppeeieren godkjenne bilder og video før de andre barna ser dem. Videoer spiller aldri av automatisk.
- **Lukkede grupper.** Barn ser bare innlegg fra gruppene sine, for eksempel klassen eller en vennegjeng. Det finnes ingen søk, ingen profiler å bla i og ingen direktemeldinger.

**Informasjonsside:** [`/om`](public/om.html) forklarer valgene som gjør quipu trygt for barn, og historien bak navnet. Siden er åpen uten innlogging, så den kan deles med foresatte og skolen. Den lenkes fra innloggingssiden, bunnteksten og Konto-fanen. [`/hvem`](public/hvem.html) viser hvem som står bak quipu, slik at appen har en ekte avsender.

## Roller

| Hvem | Kan |
|---|---|
| **Foresatt** | Registrere seg og logge inn med e-post, lage og slette barnekontoer, sette grenser, lage grupper (og få en invitasjonskode), melde barna inn og ut av grupper, lese alt i gruppene barna er med i, slette barnas innlegg og slette hele kontoen sin med alle data. |
| **Gruppeeier** (foresatt som laget gruppa) | Det samme, og i tillegg godkjenne bilder og video, se rapporterte innlegg og vise dem igjen eller fjerne dem, og slå av eller på kravet om godkjenning for gruppa. |
| **Barn** | Logge inn med brukernavnet og passordet den foresatte har laget (barn har ikke e-post), lese feeden, dele innlegg med bilde eller video, slette egne innlegg og trykke «🚩 Si fra». Et innlegg som blir rapportert, skjules med en gang til en voksen har sett på det. |

**Åpenhet overfor barna:** Første gang et barn logger inn, får det en kort introduksjon. Den forteller blant annet at foreldrene deres, og foreldrene til de andre i gruppa, kan lese alt som deles i gruppa. Det står også fast der barnet deler («6B og foreldrene i gruppa ser det du deler»). Introduksjonen kan åpnes igjen med «Slik fungerer quipu» nederst i feeden.

**Innlogging:** Én side for alle, med feltet «E-post eller brukernavn». Foresatte bruker e-post. Barn bruker brukernavnet de har fått. Foresatte som registrerte seg før e-post kom, kan også bruke det gamle brukernavnet.

Barn kan ikke registrere seg selv. Det er alltid en foresatt som lager kontoen, slik at det er samtykke fra foresatte (GDPR-kravet for barn under 13 år i Norge).

## Glemt passord

- **Foresatte:** «Glemt passord?» på innloggingssiden sender en lenke til e-posten på kontoen. Lenken virker i én time og kan bare brukes én gang, og alle andre enheter blir logget ut når passordet endres. Svaret er det samme uansett om e-posten finnes, så ingen kan sjekke hvem som har konto. E-post og passord kan også endres under **Konto**.
- **Barn:** Foresatte setter nytt passord under **Barn → grenser og passord**.
- **Foresatte uten e-post på kontoen** (de som registrerte seg før funksjonen kom) får en oppfordring om å legge den inn. Er de allerede låst ute, kan den som drifter tjenesten lage en lenke (se under).

### Sende e-post

Legg inn disse miljøvariablene (i Render: tjenesten → **Environment**):

| Variabel | Eksempel |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com`, `smtp-relay.brevo.com`, `smtp.office365.com` |
| `SMTP_PORT` | `587` (eller `465`) |
| `SMTP_USER` | brukernavnet hos e-postleverandøren |
| `SMTP_PASS` | passordet, for Gmail et [app-passord](https://myaccount.google.com/apppasswords) |
| `MAIL_FROM` | `quipu <hei@quipu.no>` (standard: `SMTP_USER`) |

**quipu bruker `hei@quipu.no`** (e-postkonto på webhotellet hos Domene.no, cPanel). Innstillingene står i cPanel under **Email Accounts → Connect Devices** for kontoen. Bruk de sikre SSL/TLS-innstillingene for utgående server (SMTP) der, som regel port `465`:

| Variabel | Verdi |
|---|---|
| `SMTP_HOST` | utgående server fra «Connect Devices» |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `hei@quipu.no` |
| `SMTP_PASS` | passordet til e-postkontoen |
| `MAIL_FROM` | `quipu <hei@quipu.no>` |

Sjekk oppsettet ved å åpne **Shell** i Render og kjøre `npm run test-mail -- din@epost.no`.

Uten `SMTP_HOST` sendes ingen e-post. Lenken skrives i stedet til serverloggen (Render → **Logs**). Lenkene peker til `APP_URL`, eller til `RENDER_EXTERNAL_URL`, som Render setter automatisk.

### Lage lenke for nytt passord på serveren

Hvis en foresatt er låst ute og ikke har e-post på kontoen, åpner du **Shell** for tjenesten i Render og kjører:

```bash
npm run reset-link -- e-post-eller-brukernavn
```

Kommandoen skriver ut en lenke som virker i én time. Gi den bare til den det gjelder.

### Nullstille alt

For å slette alle kontoer, grupper, innlegg, bilder og videoer, og logge ut alle, åpner du **Shell** i Render og kjører:

```bash
npm run reset-all              # viser hva som vil bli slettet, sletter ingenting
npm run reset-all -- SLETT-ALT # sletter alt
```

Dette kan ikke angres i appen. Render tar daglige øyeblikksbilder av disken, så en nylig kopi kan gjenopprettes fra Render sitt dashbord.

## Design

Rolig og moderne uttrykk med strekikoner og quipu-paletten: petrol `#0E5B5E`, korall `#F4795B`, nesten svart `#17171B` og kremhvit `#F7F5F1`. **Lys modus** har korall bakgrunn med hvite kort og petrol knapper. **Mørk modus** har petrol bakgrunn med mørke petrolkort og korall knapper. Tekst som ligger rett på bakgrunnen, har egne farger (`--on-bg`), og all tekst er sjekket mot WCAG AA (minst 4,5 : 1). Logoen er Q-boblen med ansikt (øyne og smil), tegnet som eksakte vektorformer i `public/brand.js`. Ansiktet lever: det blunker av og til, ser til siden en sjelden gang, og blunker med ett øye og smiler når man trykker på det. Med «Reduser bevegelse» på telefonen står det stille. Når appen åpnes, vises en load-skjerm (i `index.html`): Q-en spretter inn, øynene åpnes, munnen går fra strek til smil, og den blunker før den vokser og tones ut når appen er klar. Den vises minst 1,6 sekunder og forsvinner uansett etter 6. Den er nesten svart i lys modus og kremhvit i mørk modus, og appikonet er kremhvit på petrol. Nye innlegg skrives i et ark som glir opp nedenfra, og foresatte har faner for barn, grupper og konto.

## Mobil: iPhone, iPad og Android

Appen er laget for mobil først. Den har store trykkflater, støtter hakket og hjem-linja på iPhone og zoomer ikke inn når man skriver. Den er en installerbar nettapp (PWA), så den trenger ingen App Store eller Google Play:

- **iPhone/iPad (Safari):** Åpne adressen, trykk Del-knappen ⬆️ og velg «Legg til på Hjem-skjerm».
- **Android (Chrome):** Åpne adressen, trykk menyen ⋮ og velg «Legg til på startsiden» eller «Installer app».

Da åpnes quipu som en egen app med eget ikon og uten nettleserlinjer.

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
| `APP_URL` | `RENDER_EXTERNAL_URL` eller `http://localhost:3000` | Adressen som brukes i lenker på e-post |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | – | E-post, se «Sende e-post» |

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
