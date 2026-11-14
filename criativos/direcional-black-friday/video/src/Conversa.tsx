import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from 'remotion';

// ---------- Linha do tempo (frames @30fps) ----------
const T = {
  amor: 15,
  completa: 40,
  meioCoracao: 70,          // balão com a metade do coração (desenhada)
  digitando1: 110,          // "digitando..." antes da resposta
  resposta: 150,            // balão de resposta com a mesma metade
  tentaCompletar: 168,      // traço tenta fechar o coração
  volta: 202,               // traço recua
  letras: 228,              // escrita letra a letra
  porLetra: 9,
  digitando2: 330,
  oferta: 370,
  jaEntendi: 410,
  cta: 445,
};
export const DURACAO = 540;

// ---------- Efeitos sonoros ----------
const sfx: {f: string; em: number; vol?: number}[] = [
  {f: 'enviar', em: T.amor},
  {f: 'enviar', em: T.completa},
  {f: 'enviar', em: T.meioCoracao},
  {f: 'rabisco_longo', em: T.meioCoracao + 4, vol: 0.8},
  {f: 'digitando', em: T.digitando1 + 2, vol: 0.5},
  {f: 'receber', em: T.resposta},
  {f: 'rabisco_longo', em: T.tentaCompletar, vol: 0.7},
  {f: 'rebobinar', em: T.volta, vol: 0.9},
  ...Array.from({length: 10}, (_, i) => ({f: 'rabisco_curto', em: T.letras + i * 9, vol: 0.75})),
  {f: 'digitando', em: T.digitando2 + 2, vol: 0.5},
  {f: 'receber', em: T.oferta},
  {f: 'enviar', em: T.jaEntendi},
  {f: 'cta', em: T.cta - 10, vol: 0.9},
];

const verde = '#d9fdd3';
const ease = Easing.bezier(0.4, 0, 0.2, 1);

// ---------- Traços ----------
const meioCoracaoGrande =
  'M390 210 C 376 150, 340 124, 304 126 C 258 128, 232 168, 240 214 C 250 268, 324 318, 390 380';

// metade esquerda (vira o "C") e a metade que tenta completar o coração
const cMetade = 'M292 58 C 286 36, 272 26, 260 27 C 240 28, 230 48, 234 70 C 240 100, 268 120, 292 136';
const cCompleta = 'M292 58 C 298 36, 312 26, 324 27 C 344 28, 354 48, 350 70 C 344 100, 316 120, 292 136';

// letras na ordem de escrita (o C já existe)
const letras: {d: string; dx?: number}[] = [
  {d: 'M24 30 C 22 70, 26 100, 24 132 M24 32 C 80 22, 82 78, 26 80 C 92 76, 92 138, 24 132'},           // B
  {d: 'M96 30 C 94 66, 98 100, 96 132 C 116 133, 132 130, 148 132'},                                    // L
  {d: 'M160 134 C 170 100, 180 64, 190 34 C 202 70, 212 104, 222 132 M172 98 C 186 94, 198 94, 212 92'},// A
  {d: 'M322 30 C 320 66, 324 100, 322 134 M372 32 C 356 56, 340 72, 324 84 C 342 100, 358 116, 376 134'},// K
  {d: 'M424 132 C 422 100, 426 64, 424 34 C 444 32, 460 34, 474 30 M424 82 C 438 82, 450 80, 462 80'},  // F
  {d: 'M494 134 C 493 100, 490 64, 492 36 C 544 26, 550 84, 495 80 C 514 96, 529 112, 546 136'},        // R
  {d: 'M572 36 C 570 68, 574 100, 571 134'},                                                             // I
  {d: 'M600 36 C 598 70, 602 104, 600 134 M598 36 C 664 26, 672 128, 602 132'},                          // D
  {d: 'M688 134 C 698 100, 708 64, 718 34 C 730 70, 740 104, 750 132 M700 98 C 714 94, 726 94, 740 92', dx: -22}, // A
  {d: 'M770 34 C 780 56, 792 74, 800 84 M832 34 C 816 60, 806 74, 800 84 C 798 100, 802 118, 800 136', dx: -22}, // Y
];

const Traco: React.FC<{d: string; p: number; w?: number; dx?: number}> = ({d, p, w = 7, dx = 0}) => (
  <path d={d} pathLength={1} transform={`translate(${dx},0)`}
    style={{fill: 'none', stroke: '#111', strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round',
      strokeDasharray: 1, strokeDashoffset: 1 - Math.max(0, Math.min(1, p)), opacity: p <= 0 ? 0 : 1}} />
);

// ---------- Componentes de balão ----------
const usePop = (inicio: number) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: frame - inicio, fps, config: {damping: 14, stiffness: 160, mass: 0.6}});
  return {
    visivel: frame >= inicio,
    style: {opacity: interpolate(frame - inicio, [0, 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      transform: `translateY(${(1 - s) * 40}px) scale(${0.85 + 0.15 * s})`},
  };
};

const Hora: React.FC<{h: string; lido?: boolean; branco?: boolean}> = ({h, lido, branco}) => (
  <span style={{fontSize: 28, color: branco ? '#fff' : '#667781', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8}}>
    {h}
    {lido !== undefined && <Ticks cor={branco ? '#fff' : '#53bdeb'} />}
  </span>
);
const Ticks: React.FC<{cor: string}> = ({cor}) => (
  <svg width="34" height="20" viewBox="0 0 34 20"><path d="M2 11 L8 17 L20 4 M14 15 L16 17 L30 3"
    style={{fill: 'none', stroke: cor, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round'}} /></svg>
);

const Linha: React.FC<{lado: 'out' | 'in'; inicio: number; children: React.ReactNode}> = ({lado, inicio, children}) => {
  const {visivel, style} = usePop(inicio);
  if (!visivel) return null;
  return (
    <div style={{display: 'flex', justifyContent: lado === 'out' ? 'flex-end' : 'flex-start', margin: '14px 0',
      transformOrigin: lado === 'out' ? 'right bottom' : 'left bottom', ...style}}>
      {children}
    </div>
  );
};

const Texto: React.FC<{lado: 'out' | 'in'; children: React.ReactNode; h: string}> = ({lado, children, h}) => (
  <div style={{background: lado === 'out' ? verde : '#fff', borderRadius: 22, padding: '18px 26px', fontSize: 40, color: '#111',
    display: 'flex', alignItems: 'flex-end', gap: 18, boxShadow: '0 2px 2px rgba(0,0,0,.08)'}}>
    <span>{children}</span><Hora h={h} lido={lado === 'out' ? true : undefined} />
  </div>
);

const Fwd = () => (
  <div style={{width: 60, height: 60, borderRadius: 30, background: '#fff', alignSelf: 'center', margin: '0 18px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,.12)'}}>
    <svg width="30" height="24" viewBox="0 0 30 24"><path d="M18 3 L27 11 L18 19 M27 11 C 15 11, 6 13, 3 21"
      style={{fill: 'none', stroke: '#555', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round'}} /></svg>
  </div>
);

const Desenho: React.FC<{lado: 'out' | 'in'; w: number; h: number; hora: string; children: React.ReactNode}> = ({lado, w, h, hora, children}) => (
  <div style={{padding: 8, borderRadius: 22, background: lado === 'out' ? verde : '#fff'}}>
    <div style={{width: w, height: h, background: '#f2f2f2', borderRadius: 16, position: 'relative', overflow: 'hidden'}}>
      {children}
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, background: 'linear-gradient(transparent, rgba(0,0,0,.45))'}} />
      <div style={{position: 'absolute', right: 18, bottom: 10}}><Hora h={hora} lido={lado === 'out' ? true : undefined} branco /></div>
    </div>
  </div>
);

const Digitando: React.FC<{de: number; ate: number}> = ({de, ate}) => {
  const frame = useCurrentFrame();
  const {style} = usePop(de);
  if (frame < de || frame >= ate) return null;
  return (
    <div style={{display: 'flex', margin: '14px 0', transformOrigin: 'left bottom', ...style}}>
      <div style={{background: '#fff', borderRadius: 22, padding: '26px 30px', display: 'flex', gap: 12, boxShadow: '0 2px 2px rgba(0,0,0,.08)'}}>
        {[0, 1, 2].map((i) => {
          const k = Math.sin(((frame - de) / 30) * Math.PI * 2.4 - i * 0.9);
          return <div key={i} style={{width: 18, height: 18, borderRadius: 9, background: '#8696a0',
            opacity: 0.45 + 0.55 * Math.max(0, k), transform: `translateY(${-6 * Math.max(0, k)}px)`}} />;
        })}
      </div>
    </div>
  );
};

// ---------- Vídeo ----------
export const Conversa: React.FC = () => {
  const frame = useCurrentFrame();
  const prog = (a: number, dur: number) =>
    interpolate(frame, [a, a + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});

  // metade do coração no 1º desenho
  const pMeio = prog(T.meioCoracao + 4, 22);

  // tentativa de completar: vai até ~75%, segura, e volta
  const pCompletar =
    frame < T.volta
      ? prog(T.tentaCompletar, 24) * 0.6
      : 0.6 * (1 - prog(T.volta, 16));

  const cta = usePop(T.cta);

  return (
    <AbsoluteFill style={{background: '#efe7dd', fontFamily: '"Helvetica Neue", Roboto, Arial, sans-serif'}}>
      <AbsoluteFill style={{opacity: 0.07,
        backgroundImage: 'radial-gradient(circle at 20px 20px,#000 2px,transparent 3px),radial-gradient(circle at 60px 70px,#000 1.5px,transparent 2.5px)',
        backgroundSize: '90px 90px'}} />

      <div style={{position: 'absolute', left: 0, right: 0, top: 380, padding: '0 34px'}}>
        <Linha lado="out" inicio={T.amor}><Texto lado="out" h="23:58">amor</Texto></Linha>
        <Linha lado="out" inicio={T.completa}><Texto lado="out" h="23:58">completa?</Texto></Linha>

        <Linha lado="out" inicio={T.meioCoracao}>
          <Fwd />
          <Desenho lado="out" w={780} h={470} hora="23:58">
            <svg width={780} height={470} viewBox="0 0 780 470"><Traco d={meioCoracaoGrande} p={pMeio} w={9} /></svg>
          </Desenho>
        </Linha>

        <Digitando de={T.digitando1} ate={T.resposta} />
        <Linha lado="in" inicio={T.resposta}>
          <Desenho lado="in" w={860} h={200} hora="23:59">
            <svg width={860} height={200} viewBox="-10 -12 840 172" preserveAspectRatio="xMidYMid meet">
              <g transform="translate(0,0)"><Traco d={cMetade} p={1} /></g>
              <Traco d={cCompleta} p={pCompletar} />
              {letras.map((l, i) => (
                <Traco key={i} d={l.d} dx={l.dx} p={prog(T.letras + i * T.porLetra, T.porLetra + 2)} />
              ))}
            </svg>
          </Desenho>
          <Fwd />
        </Linha>

        <Digitando de={T.digitando2} ate={T.oferta} />
        <Linha lado="in" inicio={T.oferta}>
          <Texto lado="in" h="23:59">Na Direcional tem apê de 60m², entrada em 60x e parcelas a partir de R$&nbsp;299 👀</Texto>
        </Linha>
        <Linha lado="out" inicio={T.jaEntendi}><Texto lado="out" h="23:59">Já entendi...</Texto></Linha>
      </div>

      {sfx.map((x, i) => (
        <Sequence key={i} from={x.em} layout="none">
          <Audio src={staticFile(`sfx/${x.f}.wav`)} volume={x.vol ?? 1} />
        </Sequence>
      ))}

      {cta.visivel && (
        <>
          <div style={{position: 'absolute', left: 90, right: 90, top: 1570, textAlign: 'center', fontSize: 21, color: '#555',
            lineHeight: 1.35, opacity: cta.style.opacity}}>
            Black Friday Direcional 2026. Condições válidas por tempo limitado, para unidades e empreendimentos participantes,
            sujeitas a análise de crédito. Consulte o regulamento.
          </div>
          <div style={{position: 'absolute', left: 0, right: 0, top: 1665, display: 'flex', justifyContent: 'center'}}>
            <div style={{background: '#fff', borderRadius: 60, padding: '22px 64px', fontSize: 54, fontWeight: 600, color: '#111',
              whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.12)', ...cta.style}}>🏠 Link na bio</div>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};
