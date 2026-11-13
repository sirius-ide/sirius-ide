# Code as you type

Tab completion fills in code at the cursor, as you type, from a code model on your own machine.

- **Ollama:** pull a coder model — for example `ollama pull qwen2.5-coder:1.5b` — and Sirius picks it up.
- **llama.cpp:** start `llama-server` with a code model; give its address and key in **Models and Keys** if it is not at `localhost:8080`.

Press **Tab** to take a suggestion, **Escape** to leave it. The **Tab** item in the status bar says whether completion is on and which model fills in; click it to turn completion off for one language, or to pick the model. Nothing you type goes anywhere but the server you run.
