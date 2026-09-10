import re, sys
#!/usr/bin/env python3
# Auditoria do Lumnis — roda antes de cada commit:  python3 auditoria.py
#
# Pega os 3 erros que mais custaram tempo neste projeto:
#  1. regra CSS de aba com seletor de ID sem .active (a aba vaza para
#     todas as telas, porque ID=100 vence .tab-view{display:none}=10)
#  2. onclick/oninput chamando funcao que nao existe
#  3. getElementById de id inexistente, sem guarda

css = open('style.css', encoding='utf-8').read()
html = open('index.html', encoding='utf-8').read()
css_nc = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
erros = []

# 1) regra de ID de aba sem .active que mexe em display -> vaza entre telas
for m in re.finditer(r'(#tab-[a-z]+)((?:[.:][a-z-]+)?)\s*\{([^}]*)\}', css_nc):
    if 'display' in m.group(3) and '.active' not in m.group(2):
        erros.append(f'vazamento de aba: {m.group(1)}{m.group(2)} define display sem .active')

# 2) handlers inline apontando para funcao inexistente
js = ''.join(open(f, encoding='utf-8').read() for f in
             ['01-core.js','02-ui.js','03-perfil.js','04-contas.js','05-init.js','06-onboarding.js','07-apagar.js'])
for fn in sorted(set(re.findall(r'on[a-z]+="([a-zA-Z_$][\w$]*)\(', html))):
    if fn in ('if','return','this'): continue
    if not re.search(r'(function\s+%s\b|window\.%s\s*=)' % (fn, fn), js):
        erros.append(f'funcao fantasma: {fn}() e chamada no HTML mas nao existe')

# 3) ids referenciados no JS que nao existem no HTML nem sao criados dinamicamente
ids_html = set(re.findall(r'id="([\w-]+)"', html))
ids_js   = set(re.findall(r"getElementById\('([\w-]+)'\)", js))
criados  = set(re.findall(r"\.id\s*=\s*'([\w-]+)'", js)) | set(re.findall(r'id="([\w-]+)"', js))
# So reporta id ausente quando o acesso NAO tem guarda (?. ou if):
# sem guarda, o .textContent de null lanca TypeError e derruba a tela.
faltando = sorted(ids_js - ids_html - criados)
for i in faltando:
    if re.search(r"getElementById\('%s'\)\s*\.[a-zA-Z]" % re.escape(i), js):
        erros.append(f'id ausente SEM guarda: getElementById("{i}") lanca TypeError')

# 4b) o layout da aba da IA e definido por JS (_ajustarAlturaChatIA).
#     Qualquer regra CSS mirando #tab-ia com display/height/position
#     volta a competir e quebra o campo de texto.
for m in re.finditer(r'([^{}\n]*#tab-ia[^{,]*)\{([^}]*)\}', css_nc):
    sel = m.group(1).strip()
    if sel.endswith(('#tab-ia', '#tab-ia.active')) and re.search(r'(^|[;\s])(display|height|position)\s*:', m.group(2)):
        erros.append('CSS mira #tab-ia com display/height/position — quem controla e o JS')

# 4) regras do chat da IA espalhadas: elas so podem viver no bloco
#    autoritativo no fim do style.css. Fora dele, brigam por
#    especificidade e o layout quebra (aconteceu 4 vezes).
linhas_chat = [css_nc[:m.start()].count('\n') + 1
               for m in re.finditer(r'[^{}\n]*#tab-ia[^{]*\{', css_nc)]
if linhas_chat and (max(linhas_chat) - min(linhas_chat)) > 120:
    erros.append('regras de #tab-ia espalhadas pelo style.css (L%d a L%d) — '
                 'mantenha tudo no bloco autoritativo do fim do arquivo'
                 % (min(linhas_chat), max(linhas_chat)))

print('\n'.join('  ✗ ' + e for e in erros) if erros else '  ✓ nenhum problema')
sys.exit(1 if erros else 0)
