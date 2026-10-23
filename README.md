# quipu

*(Arbeidsnavn i koden: SoMe. Navn og logo ligger i `public/brand.js` og `server/config.js`.)*

En ekte, men rolig sosial kanal for barn (laget for mellomtrinnet), og det motsatte av X og Facebook:

- **Ingen likes, hjerter, stjerner, følgere eller tall.** Ingenting å konkurrere om.
- **Vennlige innlegg.** Barna kan skrive fritt, stille spørsmål og dele tips. De kan sette en valgfri merkelapp på innlegget: *Glad for*, *Lærte noe*, *Takk til*, *Har laget*, *Spørsmål*, *Tips*, *Gleder meg til* eller *Har opplevd*. Et snillfilter på serveren stopper stygge ord, telefonnumre, e-post, adresser, lenker og brukernavn fra andre apper.
- **Laget for lite bruk.** Feeden viser bare de siste tre dagene og tar slutt («Du har sett alt som er nytt!»). Det er ingen uendelig scrolling og ingen varsler. Mens feeden er åpen, sjekker appen hvert 20. sekund om de andre har delt noe nytt, og viser da en rolig knapp øverst («2 nye innlegg»). Innleggene settes ikke inn av seg selv, så teksten ikke hopper, og det sjekkes bare når appen vises på skjermen. Foresatte får det samme når de ser på innleggene i en gruppe. Foresatte bestemmer daglig tidsgrense (standard 20 min), åpningstider (standard 07–20; appen er alltid stengt minst 10 timer i strekk og mellom 23 og 06) og antall innlegg per dag (standard 5, 0–10). Ubrukte innlegg fra i går kan brukes dagen etter, men aldri mer enn dobbelt så mange som dagsgrensen på én dag. Alt dette håndheves på serveren.
- **Bilder og video.** Hver video kan være maks 30 sekunder og 50 MB. Grensene kan endres, se under. GPS-posisjon og annen metadata fjernes fra både bilder og video. Som standard må gruppeeieren godkjenne bilder og video før de andre barna ser dem. Videoer spiller aldri av automatisk.
- **Lukkede grupper.** Barn ser bare innlegg fra gruppene sine, for eksempel klassen eller en vennegjeng. Det finnes ingen søk, ingen profiler å bla i og ingen direktemeldinger.
- **Kontoer og innlogginger.** Under **Konto** ser foresatte alle innloggingene sine og kan logge ut én eller alle andre. De får e-post ved innlogging fra en ny type enhet, nytt passord og ny e-postadresse (også til den gamle). Bremsen mot passordgjetting lagres i databasen (bare hash). Foresatte er innlogget i 14 dager, barn i 30. Under **Konto** ligger også lenkene man har sendt (kan trekkes tilbake) og nedlasting av alle egne data som JSON.
- **Si fra.** Barnet velger hva det gjelder (mobbing, trusler, ekkel kontakt, farlige bilder, annet), og får beskjed om hva som skjer og om Alarmtelefonen for barn og unge (116 111, alltid åpen) og Kors på halsen (800 33 321). «Si fra om noe annet» nederst i feeden går bare til administrator, også når det gjelder en voksen. Den, 112 og Alarmtelefonen vises også når appen er stengt eller tiden er brukt opp. Et meldt innlegg slettes ikke når forfatteren sletter det, men skjules, og administrator kan bevare det som dokumentasjon.
- **Alvorlige saker.** «Si fra» i kategoriene trusler, ekkel kontakt og farlige bilder blir en sak som en navngitt administrator må kvittere for («Jeg tar ansvar» under Admin). Vakthavende på vaktlisten varsles straks på e-post og push. Uten kvittering innen 15 minutter (`KVITTERING_MINUTTER`) varsles reserven, så resten av lista, og til slutt alle administratorer og `BEREDSKAP_EPOST`, på nytt hvert kvarter. Hvert varsel logges som sendt eller feilet; bare kvitteringen regnes som at noen har tatt ansvar. Varslene inneholder ikke barnets melding. E-post må være satt opp, ellers feiler e-postvarslene (det vises under Admin).
- **Administrasjon.** Den som drifter quipu, får fanen **Admin** med `npm run admin -- <e-post>` (ta det bort med `npm run admin -- <e-post> av`). Det kan ikke slås på i appen, og administrasjonen krever to-trinns innlogging (engangskode fra en autentiseringsapp, på hver enhet og på nytt etter 12 timer; mistet telefon: `npm run admin -- <e-post> nullstill`). Der ser man bruk som tall (dagssummer uten navn, så de kan beholdes etter at skjermtid slettes etter 30 dager), innlegg som er meldt med «Si fra» fra alle grupper, med hva det gjelder og alvorlige saker først (fjern, vis igjen eller bevar som dokumentasjon), meldinger barn sender med «Si fra om noe annet» (bare administrator ser dem), søk etter kontoer og utestenging med grunn. En stengt konto logges ut overalt og kommer ikke inn igjen. En stengt foresatt kan ikke registrere seg på nytt med samme e-post (bare en hash lagres), og barn som ikke har en annen foresatt, stenges også. Åpnes kontoen igjen, åpnes de barna også. Alt som gjøres, logges.
- **Flere foresatte per barn.** På barnekortet under **Barn** trykker man «Del med en annen foresatt» og får en engangslenke (7 dager), sendt på e-post eller delt selv. Den som åpner den, blir foresatt med samme tilgang, enten hen lager konto (uten registreringskode) eller logger inn. De andre foresatte får e-post om det. Ingen kan fjerne en annen foresatt, bare seg selv, og barnekontoen kan bare slettes når det er én foresatt igjen. Sletter en foresatt kontoen sin, beholdes barn som har andre foresatte. Barnet har ingen fast kode, fordi en kode på avveie ville gitt fremmede foresatt-tilgang.
- **Bare inviterte foresatte.** Under **Konto** trykker en foresatt «Inviter foresatt» og får en personlig lenke, sendt på e-post eller delt selv. Med lenken lager den inviterte konto uten registreringskode. Den virker i 14 dager og kan brukes én gang, og serveren husker hvem som inviterte hvem. Under **Grupper** har hver gruppe knappen «Inviter foresatte». Da gjelder invitasjonen gruppa: nye foresatte lager konto, og både nye og de som har konto, kan melde barnet inn uten invitasjonskode (under **Barn**). Har eieren invitert, slipper barnet rett inn, ellers godkjenner eieren som vanlig. Man kan skrive inn mange e-postadresser, og hver blir en tagg når man trykker mellomrom. Registreringskoden (`REGISTRATION_CODE`) trengs bare for dem som starter uten invitasjon.
- **Godkjente medlemmer.** Med invitasjonskoden ber en foresatt om at barnet får bli med. Eieren av gruppa får en e-post, ser barnets navn og navnet og e-posten til den foresatte, og godkjenner eller avslår under **Grupper**. Barnet ser ingenting i gruppa før det er godkjent. Eierens egne barn slipper rett inn.
- **Bekreftet e-post.** Nye foresatte får en lenke på e-post (gyldig i 48 timer) og må åpne den før de kan lage barnekontoer eller grupper. Ny e-postadresse på en bekreftet konto tas først i bruk når lenken til den nye adressen er åpnet.

**Informasjonsside:** [`/om`](public/om.html) forklarer valgene som gjør quipu trygt for barn, og historien bak navnet. Siden er åpen uten innlogging, så den kan deles med foresatte og skolen. Den lenkes fra innloggingssiden og Konto-fanen. [`/hvem`](public/hvem.html) viser hvem som står bak quipu, slik at appen har en ekte avsender. Den lenkes diskret fra Kontakt-delen på `/om`. [`/sikkerhet`](public/sikkerhet.html) er en teknisk gjennomgang av sikkerheten (innlogging, kryptering, tilgang, vern i nettleseren, bilder og video, og det som gjenstår), lenket fra `/om`.

[`/personvern`](public/personvern.html) er personvernerklæringen: hvilke opplysninger som behandles, hvorfor, hvor lenge, hvem som ser hva, databehandlere og rettigheter. Den forklarer også at quipu bare bruker én nødvendig informasjonskapsel (innloggingen) og derfor ikke trenger cookie-banner. Én gang i døgnet slettes automatisk: utløpte innlogginger og lenker, skjermtid eldre enn 30 dager, innlegg som en voksen fjernet for over 30 dager siden, alle innlegg og meldinger i voksenkontakten eldre enn 60 dager (med bilder og video, men ikke innlegg som er meldt og ikke behandlet, eller som er bevart som dokumentasjon), og administratorlogg, avsluttede alvorlige saker og behandlede meldinger fra barn eldre enn ett år. Grupper der ingen har delt noe på 182 dager, barnekontoer som ikke er brukt på 365 dager, og foresatt-kontoer uten barn og grupper som ikke er brukt på 365 dager, slettes 30 dager etter et varsel på e-post (til eieren eller de foresatte). Uten en e-post som faktisk ble sendt, slettes ingenting. «Behold gruppa» og «Behold kontoen» i appen, eller å logge inn, stopper slettingen. Stengte kontoer, administratorer og barn med innlegg eller meldinger som er bevart eller ikke ferdig behandlet, slettes ikke av seg selv.

**Bunntekst:** Alle sider for voksne (og innloggingssidene) har en bunntekst i full bredde nederst, med logo og (`public/footer.js`) med lenker til Om quipu, Hvem står bak, Kontakt, Slik gjør vi det trygt, Teknisk sikkerhet, Personvern, Logg inn og Lag konto (`/#registrer`).

**Profilbilder:** Barna har tegnede figurer, 24 «Critters» fra DiceBear (CC0 1.0), farget med paletten og lagret som SVG i `public/avatars/` (lages med `scripts/avatars.mjs`). Foresatte velger figur når de lager kontoen, og barnet kan bytte selv ved å trykke på profilbildet sitt øverst, eller på «Bytt profilbilde» nederst i feeden. Gamle emoji-profilbilder ble gjort om til figurer automatisk, også for foresatte.

**Voksenkontakt:** Hver gruppe har en egen kanal for foresatte (under **Grupper → Voksenkontakt**) der de kan gi beskjeder og diskutere. Bare eieren av gruppa og foresatte med et godkjent barn i gruppa har tilgang, og barna ser den aldri. Antall uleste meldinger vises på knappen og på fanen. Foresatte kan legge ved et bilde (ikke video), som behandles som barnas bilder (GPS og annen metadata fjernes) og bare kan ses av foresatte i gruppa. Man kan slette egne meldinger, og eieren kan slette alle. Nye meldinger dukker opp som «1 ny melding»-knapp mens den er åpen, akkurat som i feeden. Foresatte får også en figur som profilbilde, valgt automatisk. Under **Konto → Varsler fra voksenkontakten** velger hver foresatt selv om de vil ha e-post (av, kort tid etter nye beskjeder samlet i én e-post, eller én gang om dagen kl. 18) og push-varsel på hver enhet. Push er laget uten eksterne pakker (`server/push.js`: VAPID og aes128gcm-kryptering), og nøklene lages automatisk første gang. På iPhone krever push at quipu ligger på hjemskjermen (iOS 16.4 eller nyere). Logger man ut, slås push av for den enheten.

**Hjemskjermen:** Registreringssiden og Konto-fanen viser en steg-for-steg-veiledning for å legge quipu på hjemskjermen på iPhone/iPad og Android. Veiledningen for telefonen man bruker, er åpen fra start, og den skjules når appen allerede er åpnet fra hjemskjermen.

## Roller

| Hvem | Kan |
|---|---|
| **Foresatt** | Registrere seg og logge inn med e-post, lage og slette barnekontoer, sette grenser, lage grupper (og få en invitasjonskode), melde barna inn og ut av grupper, lese alt i gruppene barna er med i, slette barnas innlegg og slette hele kontoen sin med alle data. |
| **Gruppeeier** (foresatt som laget gruppa) | Det samme, og i tillegg godkjenne bilder og video, se rapporterte innlegg og vise dem igjen eller fjerne dem, og slå av eller på kravet om godkjenning for gruppa. |
| **Barn** | Logge inn med brukernavnet og passordet den foresatte har laget (barn har ikke e-post), lese feeden, dele innlegg med bilde eller video, slette egne innlegg og trykke «🚩 Si fra». Et innlegg som blir rapportert, skjules med en gang til en voksen har sett på det. |

**Åpenhet overfor barna:** Første gang et barn logger inn, får det en kort introduksjon. Den forteller blant annet at foreldrene deres, og foreldrene til de andre i gruppa, kan lese alt som deles i gruppa. Det står også fast der barnet deler («6B og foreldrene i gruppa ser det du deler»). Introduksjonen kan åpnes igjen med «Slik fungerer quipu» nederst i feeden.

**Innlogging:** Én side for alle, med feltet «E-post eller brukernavn». Foresatte bruker e-post. Barn bruker brukernavnet de har fått. Foresatte som registrerte seg før e-post kom, kan også bruke det gamle brukernavnet.

Barnekontoer kan bare lages fra en foresatt-konto, slik at det er samtykke fra foresatte (GDPR-kravet for barn under 13 år i Norge). Den som lager en foresatt-konto, bekrefter e-posten og krysser av for å være over 18 år og foresatt. Alder kontrolleres ikke (det krever f.eks. BankID/Vipps), så godkjenning fra gruppeeieren er det som holder gruppene lukket.

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

For at e-postene ikke skal havne i søppelpost, og for at ingen andre skal kunne sende e-post som ser ut til å komme fra quipu.no, må domenet ha **SPF**, **DKIM** og **DMARC** i DNS (hos Domene.no). SPF og DKIM slås som regel på i cPanel under **Email Deliverability**. Legg så til en TXT-post `_dmarc.quipu.no` med for eksempel `v=DMARC1; p=quarantine; rua=mailto:hei@quipu.no`. Sjekk resultatet ved å sende en e-post til en Gmail-konto og velge **Vis original**: SPF, DKIM og DMARC skal stå som `PASS`.

E-postene sendes som HTML (petrol bakgrunn, kremhvit logo og tekst, korall knapp) og med en ren tekstversjon for e-postprogrammer uten HTML. Malen ligger i `server/email.js`. Gmail på iPhone snur fargene i mørk modus, så bakgrunnen er låst med en gradient, teksten beskyttes med blandingsmoduser, og logo og knapper er bilder (`server/assets/`, lages med `scripts/email-assets.mjs`). Bildene legges ved inni e-posten, så de vises selv om bilder fra nettet er blokkert.

Uten `SMTP_HOST` sendes ingen e-post. Lenken skrives i stedet til serverloggen (Render → **Logs**). Det gjelder også bekreftelseslenker til nye foresatte, så e-post bør være satt opp før appen åpnes for flere. Kom lenken ikke fram, kan den som drifter tjenesten bekrefte adressen i Shell med `npm run verify-email -- foresatt@epost.no`. Lenkene peker til `APP_URL`, eller til `RENDER_EXTERNAL_URL`, som Render setter automatisk.

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

Rolig og moderne uttrykk med strekikoner og quipu-paletten, som er den eneste fargekilden. Farger, avstander, radier, skygger og fokusring ligger i `design/tokens.json`, den samme tokenfila som designsystemet bruker. `npm run tokens` bygger `public/tokens.css` av den og sjekker samtidig at all tekst holder WCAG-kontrast i begge moduser, og testene feiler hvis fila er utdatert. Paletten er: petrol (`#1F3437`, `#1F4144`, `#145B5E`, `#6C888B`, `#94A5A8`), korall (`#5E3D39`, `#B86351`, `#F3785B`, `#F7A98E`, `#F9DCCC`) og nøytrale (`#848081`, `#B6B3B2`, kremhvit `#F8F8F4`, nesten svart `#161619`, `#383638`, `#5A5758`). Lys og mørk modus speiler hverandre. **Lys modus** har lyseste korall som bakgrunn, ett hakk mørkere korall på kort og bokser, og petrol knapper med kremhvit tekst. **Mørk modus** har mørkeste petrol som bakgrunn, ett hakk lysere petrol på kort og bokser, og korall knapper med nesten svart tekst. Tekst som ligger rett på bakgrunnen, har egne farger (`--on-bg`), og all tekst er sjekket mot WCAG AA (minst 4,5 : 1). Titlene er satt i Red Hat Display (SIL Open Font License, filen ligger i `public/fonts/` sammen med lisensen), resten i systemskriften. Tastaturfokus vises som en 3 px ring i accent-fargen (petrol i lys modus, korall i mørk). Logoen er Q-boblen med ansikt (øyne og smil), tegnet som eksakte vektorformer i `public/brand.js`. Ansiktet lever: det blunker av og til, ser til siden en sjelden gang, og blunker med ett øye og smiler når man trykker på det. Med «Reduser bevegelse» på telefonen står det stille. Når appen åpnes, vises en load-skjerm (i `index.html`): Q-en spretter inn, øynene åpnes, munnen går fra strek til smil, og den blunker før den vokser og tones ut når appen er klar. Den vises minst 1,6 sekunder og forsvinner uansett etter 6. Logoen er petrol i lys modus og korall i mørk modus. Appikonet har kremhvit logo på petrol i lys modus, og korall logo på nesten svart i mørk modus. Ikonene lages av `scripts/app-icons.mjs` fra logoen og fargene i `design/tokens.json`. Ikonet i nettleserfanen (`icons/icon.svg`) bytter av seg selv. Ikonet på hjemskjermen (PNG) er den lyse varianten, fordi iOS og Android ikke lar nettapper ha egne mørke ikoner. Innlegg vises som snakkebobler med logoens form trukket ut i bredden, med samme hale: andres meldinger har motsatt farge av bakgrunnen og halen til venstre, og egne har vanlig valør av bakgrunnsfargen og halen til høyre. Nye innlegg skrives rett i feeden: et smalt skrivefelt øverst som vokser når barnet trykker i det, med bilde, emoji, valgfri merkelapp, «Avbryt» og «Del», og foresatte har faner for barn, grupper og konto.

## Mobil: iPhone, iPad og Android

Appen er laget for mobil først. Den har store trykkflater, støtter hakket og hjem-linja på iPhone og zoomer ikke inn når man skriver. Den er en installerbar nettapp (PWA), så den trenger ingen App Store eller Google Play:

- **iPhone/iPad (Safari):** Åpne adressen, trykk Del-knappen ⬆️ og velg «Legg til på Hjem-skjerm».
- **Android (Chrome):** Åpne adressen, trykk menyen ⋮ og velg «Legg til på startsiden» eller «Installer app».

Da åpnes quipu som en egen app med eget ikon og uten nettleserlinjer.

### Bilder og video

- **Bilder** skaleres ned (maks 1440 px på den lengste siden) og tegnes på nytt på telefonen før opplasting. Det fjerner EXIF/GPS og gjør HEIC-bilder fra iPhone om til WebP (kvalitet 0,8), eller JPEG (0,8) i nettlesere som ikke kan lage WebP. Serveren godtar bare JPEG og WebP, og fjerner i tillegg alle metadata.
- **Video** må være MP4 eller MOV, som er det iPhone og Android tar opp i. Lengden sjekkes på telefonen før opplasting og kontrolleres på nytt på serveren. Er en video for lang, får barnet beskjed om å klippe den i Bilder-appen. Metadata-boksene i videofila (der GPS-posisjonen ligger) nulles ut på serveren.
- **Video gjøres mindre på telefonen** før opplasting (`public/video.js`): nettleseren dekoder videoen med WebCodecs, skalerer den ned til 1280 punkter på den lengste siden og koder den som H.264 med rundt 2 Mbit/s. Lyden kopieres som den er. `public/mp4.js` leser og skriver MP4 uten kode fra andre, og beholder rotasjonen fra iPhone. 30 sekunder blir rundt 8 MB, mot 30–60 MB fra en mobil. Kan ikke nettleseren dette, eller blir fila ikke minst 10 % mindre, lastes originalen opp. Serveren gjør ingen konvertering.
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

Tjenesten bruker planen *Starter* med en disk på 1 GB i Frankfurt (EU), fordi databasen og bildene må overleve omstarter. Gratisplanen har ikke disk. Render tar daglige øyeblikksbilder av disken.

Nye endringer på grenen publiseres når testene i GitHub har gått gjennom (`autoDeployTrigger: checksPass`). Er tjenesten laget uten Blueprint, velg **Settings → Build & Deploy → Auto-Deploy: After CI Checks Pass** i Render. Testene ligger i `.github/workflows/test.yml` og kjører `npm test` og `npm audit` ved hver push.

`/healthz` svarer med feil hvis databasen ikke svarer, eller hvis varslingen av alvorlige saker ikke har kjørt på 5 minutter. Da starter Render appen på nytt. `.github/workflows/overvaking.yml` sjekker `https://www.quipu.no/healthz` hvert tiende minutt og sender e-post fra GitHub hvis den feiler. GitHub kjører planlagte jobber bare fra standardgrenen, og kan forsinke dem noen minutter.

Dependabot (`.github/dependabot.yml`) lager forslag til oppdatering av kodepakker og GitHub Actions hver uke, og med en gang når en kjent sårbarhet blir kjent.

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
| `BEREDSKAP_EPOST` | – | E-postadresser (kommaseparert) som varsles når ingen administrator har kvittert for en alvorlig sak |
| `KVITTERING_MINUTTER` | 15 | Frist for å kvittere før neste på vaktlisten varsles |
| `REGISTRATION_CODE` | – | Hvis satt, må foresatte uten invitasjon oppgi denne koden for å lage konto |
| `APP_URL` | `RENDER_EXTERNAL_URL` eller `http://localhost:3000` | Adressen som brukes i lenker på e-post |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | – | E-post, se «Sende e-post» |

Hvis det står en proxy foran appen (for eksempel nginx), må den tillate store nok opplastinger, f.eks. `client_max_body_size 55m;`.

Kjør alltid bak HTTPS i produksjon (for eksempel Caddy, nginx eller en plattform som Fly.io eller Render).

## Sikkerhet

- Passord hashes med scrypt. Økter ligger i en `HttpOnly`, `SameSite=Strict`-cookie, og bare en hash av øktnøkkelen lagres.
- Alle endringer krever JSON (CSRF-vern), og innlogging bremses etter 5 feil.
- Streng Content-Security-Policy, Permissions-Policy (ingen posisjon, kamera eller mikrofon), HSTS i drift og `Cache-Control: no-store` på API-svar. All brukertekst vises med `textContent`, aldri som HTML.
- Foresatte kan bare se og styre sine egne barn og gruppene de har tilgang til (dekket av tester).

## Tilpasning

- Ordlisten for snillfilteret: `server/filter.js`
- Innleggstyper, bakgrunner, emojier og profilbilder: øverst i `server/app.js`
- Farger og utseende: variablene øverst i `public/style.css` (egne verdier for mørk modus)
- Standardgrenser: `server/db.js`
