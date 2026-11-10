import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RotaPrivada } from './componentes/comuns';
import { AcompanharRegistro } from './paginas/acompanhar-registro';
import { CriarConta, Entrar, VerificarEmail } from './paginas/acesso';
import { MeusRegistros, NovoRegistro } from './paginas/registros';
import { SessaoCaptura } from './paginas/sessao-captura';
import { ProvedorSessao } from './sessao';
import './estilo.css';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorSessao>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/criar-conta" element={<CriarConta />} />
          <Route path="/verificar-email" element={<VerificarEmail />} />
          <Route path="/registros" element={<RotaPrivada><MeusRegistros /></RotaPrivada>} />
          <Route path="/registros/novo" element={<RotaPrivada><NovoRegistro /></RotaPrivada>} />
          <Route path="/registros/:id/sessao" element={<RotaPrivada semCabecalho><SessaoCaptura /></RotaPrivada>} />
          <Route path="/registros/:id" element={<RotaPrivada><AcompanharRegistro /></RotaPrivada>} />
          <Route path="*" element={<Navigate to="/registros" replace />} />
        </Routes>
      </BrowserRouter>
    </ProvedorSessao>
  </StrictMode>,
);
