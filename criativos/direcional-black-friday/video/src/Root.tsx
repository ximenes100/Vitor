import React from 'react';
import {Composition} from 'remotion';
import {Conversa, DURACAO, roteiroRiva} from './Conversa';
export const Root: React.FC = () => (<>
  <Composition id="ConversaBlackFriday" component={Conversa}
    durationInFrames={DURACAO} fps={30} width={1080} height={1920} />
  <Composition id="ConversaRivaCasaPrado" component={() => <Conversa roteiro={roteiroRiva} />}
    durationInFrames={DURACAO} fps={30} width={1080} height={1920} />
</>);
