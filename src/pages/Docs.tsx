import React, { useState } from 'react';
import { PageHeader } from '../components/ui';
import {
  BookOpen,
  Wand2,
  Eye,
  Rows3,
  Archive,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Info,
  UserSquare2,
  Layers,
  Search,
  Bell,
  BarChart2,
  Activity,
  FlaskConical,
  Keyboard,
  LayoutDashboard,
  Users,
} from 'lucide-react';

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const Section: React.FC<SectionProps> = ({ icon, title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 transition"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-indigo-600">{icon}</span>
          <span className="text-sm font-semibold text-gray-900">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-3 text-sm text-gray-700 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
};

const Step: React.FC<{ n: number; text: React.ReactNode }> = ({ n, text }) => (
  <div className="flex gap-3">
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
      {n}
    </span>
    <span>{text}</span>
  </div>
);

const Note: React.FC<{ tone?: 'info' | 'warning'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${tone === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-indigo-50 text-indigo-800 border border-indigo-200'}`}>
    {tone === 'warning'
      ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
    <span>{children}</span>
  </div>
);

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{children}</kbd>
);

export const Docs: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Documentación"
        description="Guía de uso para el equipo. Aquí encontrarás cómo funciona cada sección de la plataforma."
      />

      <div className="space-y-3">

        {/* Overview */}
        <Section icon={<BookOpen className="w-5 h-5" />} title="¿Qué hace esta plataforma?" defaultOpen>
          <p>
            Esta plataforma genera imágenes de <strong>catálogo de moda</strong> usando inteligencia artificial.
            El proceso es: subís una prenda, elegís un modelo fotográfico y sus poses, y la IA genera fotos del modelo usando esa prenda.
          </p>
          <p>
            Podés generar muchas imágenes en paralelo (un <em>lote</em>), revisar los resultados, y descargar las que quedaron bien.
            Si alguna imagen no convence, podés regenerarla con un solo clic.
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Flujo básico</p>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              {['Crear cliente', '→', 'Crear modelo con poses', '→', 'Subir prenda', '→', 'Crear lote', '→', 'Revisar y descargar'].map((s, i) => (
                <span key={i} className={s === '→' ? 'text-gray-400' : 'rounded-full bg-indigo-100 text-indigo-700 px-2.5 py-1'}>{s}</span>
              ))}
            </div>
          </div>
        </Section>

        {/* Roles */}
        <Section icon={<Layers className="w-5 h-5" />} title="Roles y permisos">
          <p>Existen tres roles. Tu rol determina qué podés hacer en la plataforma.</p>
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-1">Administrador</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Acceso completo a todas las secciones</li>
                <li>Gestionar clientes, modelos y usuarios</li>
                <li>Crear y configurar lotes de generación</li>
                <li>Regenerar imágenes, cancelar y reencolar trabajos</li>
                <li>Ver analíticas y estado del sistema</li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-1">Operador</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Crear nuevos lotes de generación</li>
                <li>Monitorear la cola de trabajos</li>
                <li>Revisar resultados y regenerar imágenes</li>
                <li>Descargar imágenes individuales o lotes completos</li>
                <li>Buscar en el archivo histórico</li>
                <li><em>No puede gestionar clientes, modelos ni usuarios</em></li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-1">Revisor</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Ver la cola de trabajos (solo lectura)</li>
                <li>Revisar y descargar resultados</li>
                <li>Ver analíticas y estado del sistema</li>
                <li>Buscar en el archivo histórico</li>
                <li><em>No puede crear lotes, regenerar imágenes ni cancelar trabajos</em></li>
              </ul>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">Función</th>
                  <th className="border border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">Admin</th>
                  <th className="border border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">Operador</th>
                  <th className="border border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">Revisor</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Crear lotes (Generar)', '✓', '✓', '—'],
                  ['Cola y seguimiento', '✓', '✓', '✓'],
                  ['Revisar resultados', '✓', '✓', '✓'],
                  ['Regenerar imágenes', '✓', '✓', '—'],
                  ['Cancelar / reencolar', '✓', '✓', '—'],
                  ['Descargar imágenes', '✓', '✓', '✓'],
                  ['Archivo histórico', '✓', '✓', '✓'],
                  ['Analíticas', '✓', '—', '✓'],
                  ['Estado del sistema', '✓', '—', '✓'],
                  ['Gestión de clientes', '✓', '—', '—'],
                  ['Gestión de modelos', '✓', '—', '—'],
                  ['Gestión de usuarios', '✓', '—', '—'],
                ].map(([feat, a, o, r]) => (
                  <tr key={feat} className="even:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-1.5 text-gray-700">{feat}</td>
                    <td className="border border-gray-200 px-3 py-1.5 text-center text-emerald-600 font-medium">{a}</td>
                    <td className="border border-gray-200 px-3 py-1.5 text-center font-medium" style={{ color: o === '✓' ? '#059669' : '#9ca3af' }}>{o}</td>
                    <td className="border border-gray-200 px-3 py-1.5 text-center font-medium" style={{ color: r === '✓' ? '#059669' : '#9ca3af' }}>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Si necesitás permisos adicionales, pedíselos al administrador.</Note>
        </Section>

        {/* Dashboard */}
        <Section icon={<LayoutDashboard className="w-5 h-5" />} title="Dashboard">
          <p>
            La pantalla principal muestra un resumen operativo en tiempo real: clientes, modelos, trabajos completados y trabajos activos en este momento.
          </p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li><strong>Métricas clave:</strong> total de clientes, modelos, prendas únicas y trabajos completados.</li>
            <li><strong>Trabajos recientes:</strong> tabla paginada con los últimos trabajos, su estado, proveedor y modelo.</li>
            <li><strong>Actividad del equipo:</strong> lotes creados recientemente por los operadores.</li>
            <li><strong>Flujo operativo:</strong> guía de los 5 pasos principales del ciclo de trabajo.</li>
          </ul>
          <p className="font-medium text-gray-800">Estado del sistema <span className="text-xs font-normal text-gray-500">(solo admin y revisor)</span></p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Estado de salud por proveedor: latencia, código HTTP, último chequeo.</li>
            <li>Trabajos atascados en "procesando" por más tiempo del esperado.</li>
            <li>Tasa de error reciente y profundidad de la cola.</li>
            <li>Se actualiza automáticamente cada 60 segundos.</li>
          </ul>
        </Section>

        {/* Generar */}
        <Section icon={<Wand2 className="w-5 h-5" />} title="Cómo crear un lote (Generar)">
          <p>Un <strong>lote</strong> es un conjunto de trabajos de generación. Cada trabajo = un modelo + una pose + una prenda.</p>
          <div className="space-y-2">
            <Step n={1} text={<>Seleccioná el <strong>cliente</strong> y el <strong>modelo fotográfico</strong> que vas a usar.</>} />
            <Step n={2} text={<>Subí la(s) <strong>prenda(s)</strong>. Podés subir varias a la vez para procesarlas en el mismo lote.</>} />
            <Step n={3} text={<>Elegí el <strong>proveedor de IA</strong>, el <strong>formato</strong> de imagen, las <strong>poses</strong> del modelo y configurá el <strong>fondo</strong>.</>} />
            <Step n={4} text={<>Revisá el resumen (total de trabajos = poses × prendas) y hacé clic en <strong>Iniciar generación</strong>.</>} />
          </div>

          <p className="font-medium text-gray-800 mt-2">Proveedores disponibles</p>
          <div className="space-y-2">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 text-xs">Seedream v4.5 <span className="font-normal text-gray-500">(fal.ai)</span></p>
              <p className="text-gray-600 text-xs mt-0.5">Motor ByteDance mejorado. Bueno para fotos de catálogo consistentes y limpias. ~$0.04/foto.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 text-xs">Nano Banana Pro <span className="font-normal text-gray-500">(fal.ai)</span></p>
              <p className="text-gray-600 text-xs mt-0.5">Motor Gemini 3 Pro. Alta fidelidad de edición. ~$0.04/foto.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 text-xs">OpenAI gpt-image-1.5</p>
              <p className="text-gray-600 text-xs mt-0.5">Motor OpenAI. Mayor fidelidad visual. ~$0.04/foto.</p>
            </div>
          </div>

          <Note>Cuantas más prendas y poses incluyas, más trabajos se crean. Podés seguir el progreso en la sección Cola.</Note>
          <Note tone="warning">Si el proveedor está lento o con errores, el sistema reintenta automáticamente. No hace falta que hagas nada.</Note>
        </Section>

        {/* A/B */}
        <Section icon={<FlaskConical className="w-5 h-5" />} title="Experimentos A/B">
          <p>
            Los experimentos A/B permiten comparar dos proveedores de IA en el mismo lote para determinar cuál produce mejores resultados.
          </p>
          <div className="space-y-2">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-0.5">Modo Pareado</p>
              <p className="text-gray-600 text-xs">Cada combinación pose+prenda se genera con ambos proveedores. Duplica la cantidad de trabajos (y el costo), pero da una comparación directa imagen a imagen.</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-0.5">Modo Intercalado</p>
              <p className="text-gray-600 text-xs">Los proveedores se alternan entre combinaciones. Menos costo que pareado, pero los resultados son más difíciles de comparar directamente.</p>
            </div>
          </div>
          <p>En <strong>Evaluación</strong>, los lotes con experimento A/B muestran un panel con métricas por proveedor: tasa de completado, costo por trabajo, tasa de regeneración y una recomendación de ganador.</p>
          <Note tone="warning">Cuando un lote tiene un experimento A/B activo, no podés cambiar el proveedor al regenerar imágenes individuales. Esto es para no invalidar la comparación.</Note>
        </Section>

        {/* Cola */}
        <Section icon={<Rows3 className="w-5 h-5" />} title="Cola de trabajos">
          <p>La <strong>Cola</strong> muestra todos los lotes activos organizados en tres columnas: <strong>Pendiente → Procesando → Evaluación</strong>.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li><strong>Pendiente:</strong> el lote está en espera de ser procesado.</li>
            <li><strong>Procesando:</strong> la IA está generando imágenes activamente.</li>
            <li><strong>Evaluación:</strong> el lote tiene resultados o fallas listos para revisar.</li>
          </ul>
          <p className="font-medium text-gray-800">Información por lote</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Trabajos pendientes, procesándose y totales.</li>
            <li><strong>ETA estimado</strong> basado en duración promedio de trabajos recientes.</li>
            <li>Cantidad de trabajos fallidos reintentables.</li>
          </ul>
          <p className="font-medium text-gray-800">Acciones por lote <span className="text-xs font-normal text-gray-500">(admin y operador)</span></p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Abrir en Evaluación para revisar resultados.</li>
            <li><strong>Reintentar fallidos:</strong> reencola los trabajos que agotaron los reintentos automáticos.</li>
            <li><strong>Cancelar pendientes:</strong> cancela todos los trabajos en espera de ese lote (con confirmación).</li>
          </ul>
          <p className="font-medium text-gray-800">Operaciones masivas</p>
          <p>Seleccioná varios lotes con el checkbox para reencolar o cancelar sus trabajos de golpe. Se muestra un resumen de cuántos trabajos serán afectados.</p>
          <p className="font-medium text-gray-800">Filtros</p>
          <p>Podés filtrar por cliente, proveedor y estado para enfocarte en lo que importa.</p>
          <Note>El indicador de cola en la barra superior muestra cuántos trabajos están activos en tiempo real.</Note>
        </Section>

        {/* Evaluación */}
        <Section icon={<Eye className="w-5 h-5" />} title="Evaluación de resultados">
          <p>En <strong>Evaluación</strong> revisás los resultados de cada lote imagen por imagen.</p>
          <div className="space-y-2">
            <Step n={1} text="Seleccioná el lote que querés revisar desde el selector de la barra superior, o llegá desde la Cola." />
            <Step n={2} text={<>Navegá entre las imágenes con las flechas del carrusel. Podés filtrar por proveedor o estado (completado, fallido, etc.).</>} />
            <Step n={3} text={<>Si una imagen no es correcta, hacé clic en <strong>Regenerar foto</strong>. Podés cambiar el proveedor o editar el prompt antes de reenviar.</>} />
            <Step n={4} text={<>Usá los <strong>checkboxes</strong> para seleccionar varias imágenes y descargarlas juntas o reencolarlas en un solo paso.</>} />
          </div>
          <p className="font-medium text-gray-800">Funciones adicionales</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li><strong>Ver anterior:</strong> si una imagen fue regenerada, podés comparar la versión nueva con la anterior lado a lado.</li>
            <li><strong>Panel A/B:</strong> si el lote tiene experimento, muestra métricas comparativas por proveedor y una recomendación de ganador.</li>
            <li><strong>Descarga de lote completo:</strong> ZIP con todas las imágenes completadas del lote.</li>
          </ul>
          <p className="font-medium text-gray-800">Atajos de teclado</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              ['A', 'Seleccionar / deseleccionar todas las visibles'],
              ['D', 'Descargar seleccionadas'],
              ['R', 'Reencolar seleccionadas'],
              ['Esc', 'Limpiar selección'],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-1.5">
                <Kbd>{key}</Kbd>
                <span className="text-gray-500">{desc}</span>
              </div>
            ))}
          </div>
          <Note tone="warning">Los revisores pueden ver y descargar resultados, pero no pueden regenerar imágenes.</Note>
        </Section>

        {/* Archivo */}
        <Section icon={<Archive className="w-5 h-5" />} title="Archivo histórico">
          <p>El <strong>Archivo</strong> es el historial completo de todos los lotes. Podés buscar y filtrar para encontrar cualquier trabajo pasado.</p>
          <p className="font-medium text-gray-800">Filtros disponibles</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Cliente, proveedor, estado del lote y estado de los trabajos.</li>
            <li>Nombre del modelo (búsqueda de texto).</li>
            <li><strong>Rango de fechas:</strong> desde / hasta.</li>
          </ul>
          <p>Podés combinar varios filtros. Los resultados se cargan en páginas de 40 y se puede paginar.</p>
          <div className="space-y-2">
            <Step n={1} text="Aplicá los filtros para encontrar el lote que buscás." />
            <Step n={2} text="Hacé clic en un lote para ver todos sus trabajos y resultados (igual que Evaluación)." />
            <Step n={3} text={<>Descargá imágenes individuales, seleccionadas o todo el lote en un ZIP.</>} />
            <Step n={4} text={<>Si hay trabajos fallidos en un lote antiguo, podés reencolarlos desde el botón de reintento.</>} />
          </div>
          <p className="font-medium text-gray-800">Atajo de teclado</p>
          <div className="flex items-center gap-1.5 text-xs">
            <Kbd>/</Kbd>
            <span className="text-gray-500">Abre el campo de búsqueda de nombre de modelo</span>
          </div>
          <Note>Las notificaciones de la campanita en la barra superior llevan directamente al lote correspondiente en el archivo.</Note>
        </Section>

        {/* Modelos */}
        <Section icon={<UserSquare2 className="w-5 h-5" />} title="Modelos fotográficos">
          <p>
            Los <strong>modelos</strong> son las personas que aparecen en las fotos. Cada modelo tiene una o más <em>poses</em> (fotos base) que la IA usa como referencia para superponer la prenda.
          </p>
          <p>Hay dos formas de crear un modelo:</p>

          <p className="font-medium text-gray-800">Opción 1 — Subir fotos existentes</p>
          <p>Subís directamente las fotos del modelo desde tu computadora. Cada foto es una pose.</p>

          <p className="font-medium text-gray-800">Opción 2 — Generar con IA (wizard de 3 pasos)</p>
          <div className="space-y-2">
            <Step n={1} text={<><strong>Configurar identidad:</strong> elegís sexo, edad, tono de piel, color y largo de pelo, complexión, fondo y ropa base. El sistema construye el prompt automáticamente. En "Opciones avanzadas" podés editarlo manualmente.</>} />
            <Step n={2} text={<><strong>Elegir candidato:</strong> se generan 4 fotos candidatas. Elegís la que mejor representa el modelo que querés. Podés regenerar cualquiera individualmente.</>} />
            <Step n={3} text={<><strong>Seleccionar poses:</strong> elegís qué poses generar de manera individual (chips seleccionables). Cada chip seleccionado = una imagen generada. Las poses están organizadas en grupos: Cuerpo completo, Medio cuerpo y Retrato. Una vez elegidas, hacés clic en "Generar poses elegidas" — cada foto aparece conforme se va completando.</>} />
          </div>
          <p>Revisás las poses generadas y podés quitar las que no sirven antes de guardar el modelo.</p>

          <p className="font-medium text-gray-800">Poses disponibles (15 en total)</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { group: 'Cuerpo completo', poses: ['Frente completa', 'Diagonal de frente', '3/4 frente', 'Perfil lateral', 'Caminando', 'Contrapposto', 'Espalda completa', 'Espalda diagonal', '3/4 espalda'] },
              { group: 'Medio cuerpo', poses: ['Frente', 'Diagonal', '3/4', 'Espalda'] },
              { group: 'Retrato', poses: ['Frente', '3/4'] },
            ].map(({ group, poses }) => (
              <div key={group} className="rounded-lg border border-gray-200 p-2.5">
                <p className="font-semibold text-gray-700 mb-1">{group}</p>
                <ul className="space-y-0.5 text-gray-500">
                  {poses.map((p) => <li key={p}>• {p}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <p className="font-medium text-gray-800 mt-1">Gestión de modelos</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Editar nombre y cliente asignado.</li>
            <li>Agregar o quitar poses de un modelo existente.</li>
            <li>Archivar / restaurar / eliminar permanentemente.</li>
          </ul>
          <Note>La gestión de modelos es exclusiva del rol administrador.</Note>
        </Section>

        {/* Búsqueda global y notificaciones */}
        <Section icon={<Search className="w-5 h-5" />} title="Búsqueda global y notificaciones">
          <p className="font-medium text-gray-800">Búsqueda global</p>
          <p>
            Desde cualquier pantalla podés abrir la búsqueda global con <Kbd>⌘K</Kbd> (Mac) o <Kbd>Ctrl+K</Kbd> (Windows). Buscás clientes, modelos y lotes en tiempo real.
          </p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Navegá los resultados con <Kbd>↑</Kbd> <Kbd>↓</Kbd> y confirmá con <Kbd>Enter</Kbd>.</li>
            <li>Presioná <Kbd>Esc</Kbd> para cerrar.</li>
            <li>Cada resultado muestra su tipo (Cliente, Modelo, Lote) y te lleva directamente a esa sección.</li>
          </ul>

          <p className="font-medium text-gray-800 mt-1">Notificaciones <span className="inline-flex items-center gap-1"><Bell className="w-3.5 h-3.5 text-gray-500" /></span></p>
          <p>
            El ícono de campana en la barra superior muestra los últimos trabajos completados o fallidos desde que iniciaste sesión.
          </p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Muestra hasta 8 notificaciones recientes con miniatura de la prenda.</li>
            <li>Haciendo clic en una notificación abrís directamente ese lote en el Archivo.</li>
            <li>El contador se resetea al marcar como vistas.</li>
          </ul>
        </Section>

        {/* Analíticas */}
        <Section icon={<BarChart2 className="w-5 h-5" />} title="Analíticas">
          <p>
            La sección <strong>Analíticas</strong> muestra métricas de rendimiento y costo del sistema. Disponible para administradores y revisores.
          </p>
          <p className="font-medium text-gray-800">Período de análisis</p>
          <p>Podés seleccionar los últimos 7, 30 o 90 días.</p>
          <p className="font-medium text-gray-800">Métricas disponibles</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Total de trabajos: pendientes, procesando, completados y fallidos.</li>
            <li>Costo total en USD desglosado por proveedor.</li>
            <li>Gráfico de volumen diario (trabajos por día).</li>
            <li>Tasa de completado vs. fallo.</li>
            <li>Tendencia de costo a lo largo del tiempo.</li>
            <li><strong>Alerta de costo diario:</strong> configurá un umbral en USD; si se supera en el día, aparece una advertencia.</li>
          </ul>
          <p className="font-medium text-gray-800">Logs de generación de modelos</p>
          <p>Registro separado de las imágenes generadas para crear modelos con IA (candidatos y poses), con su costo asociado.</p>
          <Note>El costo mostrado es estimado basado en las tarifas configuradas por proveedor. Los costos reales pueden variar.</Note>
        </Section>

        {/* Usuarios y Clientes */}
        <Section icon={<Users className="w-5 h-5" />} title="Gestión de usuarios y clientes">
          <p className="font-medium text-gray-800">Usuarios <span className="text-xs font-normal text-gray-500">(solo admin)</span></p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Crear usuarios con email, nombre, contraseña y rol.</li>
            <li>Editar datos o cambiar rol en cualquier momento.</li>
            <li>Activar / desactivar sin eliminar (archivar / restaurar).</li>
            <li>Eliminación permanente (solo usuarios archivados).</li>
          </ul>
          <p className="font-medium text-gray-800 mt-1">Clientes <span className="text-xs font-normal text-gray-500">(solo admin)</span></p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Cada cliente agrupa sus propios modelos y lotes.</li>
            <li>Crear, editar nombre, archivar / restaurar, eliminar permanentemente.</li>
            <li>Un cliente archivado no puede recibir nuevos modelos ni lotes.</li>
          </ul>
          <Note tone="warning">Eliminar permanentemente un cliente borra también todos sus modelos e historial. Esta acción no se puede deshacer.</Note>
        </Section>

        {/* Descargas */}
        <Section icon={<Download className="w-5 h-5" />} title="Descarga de imágenes">
          <p>Hay tres formas de descargar imágenes:</p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600">
            <li><strong>Individual:</strong> botón de descarga en cada tarjeta de imagen en Evaluación o Archivo.</li>
            <li><strong>Seleccionadas:</strong> marcá varias imágenes con los checkboxes y usá el botón de descarga grupal (o el atajo <Kbd>D</Kbd>).</li>
            <li><strong>Lote completo:</strong> desde el detalle de un lote, descargá todas las imágenes completadas en un solo ZIP.</li>
          </ul>
          <Note>Los ZIPs incluyen solo imágenes con estado "completado". Las pendientes o fallidas no se incluyen.</Note>
        </Section>

        {/* Regenerar */}
        <Section icon={<RefreshCw className="w-5 h-5" />} title="Regenerar imágenes">
          <p>Si un resultado no es correcto podés <strong>regenerar</strong> la imagen. Esto crea un nuevo trabajo para esa pose+prenda y reemplaza el resultado anterior cuando esté listo.</p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600">
            <li>Podés mantener el mismo proveedor y prompt, o cambiarlos antes de regenerar.</li>
            <li>La imagen anterior queda guardada. Podés verla con el botón <strong>"Ver anterior"</strong> para comparar.</li>
            <li>Para regenerar varios trabajos fallidos de un lote a la vez, usá el botón <strong>"Fallidos reintentables"</strong> en Cola o el botón de reintento en Archivo.</li>
            <li>También podés seleccionar varias imágenes en Evaluación y usar el atajo <Kbd>R</Kbd> para reencolarlas juntas.</li>
          </ul>
          <Note tone="warning">
            Si el trabajo tiene un experimento A/B activo, el proveedor queda bloqueado para no invalidar la comparación.
          </Note>
        </Section>

        {/* Atajos de teclado */}
        <Section icon={<Keyboard className="w-5 h-5" />} title="Atajos de teclado">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Globales</p>
              <div className="space-y-1.5">
                {[
                  ['⌘K / Ctrl+K', 'Abrir búsqueda global'],
                  ['Esc', 'Cerrar búsqueda / limpiar selección'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <Kbd>{key}</Kbd>
                    <span className="text-xs text-gray-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Evaluación y Archivo</p>
              <div className="space-y-1.5">
                {[
                  ['A', 'Seleccionar / deseleccionar todas las imágenes visibles'],
                  ['D', 'Descargar imágenes seleccionadas'],
                  ['R', 'Reencolar imágenes seleccionadas (requiere permiso)'],
                  ['Esc', 'Limpiar selección actual'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <Kbd>{key}</Kbd>
                    <span className="text-xs text-gray-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Archivo</p>
              <div className="space-y-1.5">
                {[
                  ['/', 'Enfocar el campo de búsqueda por nombre de modelo'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center gap-3">
                    <Kbd>{key}</Kbd>
                    <span className="text-xs text-gray-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Tips */}
        <Section icon={<CheckCircle2 className="w-5 h-5" />} title="Consejos y buenas prácticas">
          <ul className="list-disc list-inside space-y-2 text-gray-600">
            <li><strong>Fotos de prenda limpias:</strong> las prendas sobre fondo blanco o neutro y sin arrugas dan mejores resultados.</li>
            <li><strong>Un lote por tipo de prenda:</strong> si las prendas son muy distintas (remera vs. campera), generarlas en lotes separados facilita la revisión.</li>
            <li><strong>Revisá el prompt:</strong> si el resultado no es lo que esperabas, modificar el prompt antes de regenerar suele ayudar más que simplemente reencolar.</li>
            <li><strong>Fondo blanco para e-commerce:</strong> da los resultados más limpios y consistentes para catálogo estándar.</li>
            <li><strong>Usá el archivo como referencia:</strong> buscá lotes anteriores exitosos para ver qué configuración funcionó bien con ese tipo de prenda.</li>
            <li><strong>Generación de modelos con IA:</strong> elegí ropa base neutra (playera blanca, pantalón negro) para que las prendas del catálogo se superpongan mejor sobre las poses generadas.</li>
            <li><strong>A/B para prendas complejas:</strong> si no estás seguro qué proveedor da mejor resultado con un tipo de prenda específico, creá un lote en modo pareado para comparar antes de procesar en volumen.</li>
          </ul>
        </Section>

      </div>
    </div>
  );
};
