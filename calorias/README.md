# FotoCal: calorias por foto

Web app (PWA) em português que:

- **conta as calorias de uma foto do prato** com a IA do Claude (identifica cada alimento e calcula calorias, proteína, carboidrato e gordura);
- monta um **plano personalizado** com um questionário: gasto basal (Mifflin-St Jeor), gasto diário, **meta diária de calorias**, déficit, **quanto falta perder** e a data prevista;
- registra refeições, água e peso, com gráficos de progresso.

## Como usar no celular

1. Publique a pasta (por exemplo, GitHub Pages) e abra `.../calorias/` no Safari.
2. Toque em **Compartilhar → Adicionar à Tela de Início** para instalar como app.
3. Cole a chave gratuita da IA do Google: crie em https://aistudio.google.com/apikey (não precisa de cartão).

Tudo fica salvo só no aparelho (localStorage). A chave também: não compartilhe o link com a sua chave cadastrada no aparelho de outra pessoa.

## Arquivos

- `index.html`, `styles.css`, `app.js`: interface, questionário, cálculos e diário
- `ai.js`: análise da foto com a IA do Google (Gemini, plano gratuito); descobre os modelos disponíveis para a chave e troca de modelo se a cota diária acabar
- `ai-anthropic.js` + `vendor/anthropic-sdk-1.8.0.js`: alternativa paga com o Claude (`claude-opus-5-5`); para usar, troque o import em `app.js`
- `ai-claude-app.js`: IA da versão publicada no claude.ai (usa a conta do Claude)
- `sw.js`, `manifest.webmanifest`, `icons/`: instalação como app e funcionamento offline

Os lembretes só funcionam com o app aberto (notificações push exigiriam um servidor).
As estimativas são gerais e não substituem orientação de nutricionista ou médico.

## Versão no claude.ai (sem chave)

`python3 calorias/build-artifact.py` gera `fotocal-artifact.html`, uma página única que roda dentro do claude.ai e usa o Claude da própria conta para analisar as fotos (não precisa de chave da API).
