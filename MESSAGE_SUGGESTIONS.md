# Suggerimenti per Scrivere Messaggi Efficaci

## Messaggi Predefiniti Disponibili

La landing page include questi suggerimenti predefiniti che gli utenti possono cliccare:

1. **"Ciao! Vorrei prenotare una lezione"**
   - Messaggio di apertura amichevole e diretto
   - Perfetto per iniziare la conversazione

2. **"Quali sono i tuoi orari disponibili?"**
   - Domanda specifica per la disponibilità
   - Aiuta a capire quando l'istruttore è libero

3. **"Sono principiante, puoi aiutarmi?"**
   - Comunica il livello di esperienza
   - Aiuta l'istruttore a preparare la lezione appropriata

4. **"Quanto costa una lezione?"**
   - Domanda diretta sul prezzo
   - Importante per la decisione di prenotazione

5. **"Hai disponibilità questo weekend?"**
   - Richiesta specifica per un periodo
   - Aiuta a pianificare la lezione

## Best Practices per Messaggi Efficaci

### ✅ Cosa Fare

- **Sii chiaro e diretto**: Comunica subito cosa vuoi
- **Menziona il livello**: Indica se sei principiante, intermedio o avanzato
- **Specifica preferenze**: Giorno, ora, durata della lezione
- **Fai domande**: Chiedi informazioni su disponibilità, prezzi, attrezzatura
- **Usa un tono amichevole**: Mantieni un linguaggio cortese ma informale

### ❌ Cosa Evitare

- Messaggi troppo lunghi: Mantieni i messaggi concisi
- Informazioni incomplete: Fornisci tutti i dettagli necessari
- Tono troppo formale: Sii naturale e amichevole
- Aspettative irrealistiche: Sii ragionevole con richieste e tempi

## Esempi di Messaggi per Diversi Scenari

### Prenotazione Standard
```
Ciao! Vorrei prenotare una lezione per questo sabato mattina. 
Sono principiante e ho bisogno di noleggiare l'attrezzatura.
```

### Richiesta Informazioni
```
Salve! Potresti darmi informazioni su:
- Prezzi delle lezioni
- Durata consigliata per principianti
- Attrezzatura necessaria
```

### Prenotazione Gruppo
```
Ciao! Siamo un gruppo di 3 persone, tutti principianti.
Vorremmo prenotare una lezione per domenica pomeriggio.
```

### Richiesta Specifica
```
Salve! Ho già fatto qualche lezione ma vorrei migliorare 
la tecnica. Hai disponibilità per una lezione privata?
```

## Personalizzazione dei Suggerimenti

I suggerimenti possono essere personalizzati modificando l'array `messageSuggestions` nel file `pages/index.js`:

```javascript
const [messageSuggestions] = useState([
  "Ciao! Vorrei prenotare una lezione",
  "Quali sono i tuoi orari disponibili?",
  "Sono principiante, puoi aiutarmi?",
  "Quanto costa una lezione?",
  "Hai disponibilità questo weekend?",
]);
```

Suggerimenti per personalizzare:
- Adatta i messaggi al tuo settore (sci, snowboard, etc.)
- Usa il linguaggio dei tuoi clienti target
- Aggiungi messaggi stagionali o promozionali
- Considera messaggi multilingua se necessario
