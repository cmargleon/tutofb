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
            El proceso es: subís una prenda, elegís un modelo fotográfico, y la IA genera fotos del modelo usando esa prenda.
          </p>
          <p>
            Podés generar muchas imágenes en paralelo (un <em>lote</em>), revisar los resultados, y descargar las que quedaron bien.
            Si alguna imagen no convence, podés regenerarla con un solo clic.
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Flujo básico</p>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              {['Subir prenda', '→', 'Elegir modelo', '→', 'Crear lote', '→', 'Esperar resultado', '→', 'Revisar y descargar'].map((s, i) => (
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
              <p className="font-semibold text-gray-800 mb-1">Operador</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Crear nuevos lotes de generación</li>
                <li>Ver y monitorear la cola de trabajos</li>
                <li>Revisar resultados y regenerar imágenes</li>
                <li>Descargar imágenes individuales o lotes completos</li>
                <li>Buscar en el archivo histórico</li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="font-semibold text-gray-800 mb-1">Revisor</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600">
                <li>Ver la cola de trabajos (solo lectura)</li>
                <li>Revisar y descargar resultados</li>
                <li>Ver analíticas</li>
                <li>Buscar en el archivo histórico</li>
                <li><em>No puede crear lotes ni regenerar imágenes</em></li>
              </ul>
            </div>
          </div>
          <Note>Si necesitás permisos adicionales, pedíselos al administrador.</Note>
        </Section>

        {/* Generar */}
        <Section icon={<Wand2 className="w-5 h-5" />} title="Cómo crear un lote (Generar)">
          <p>Un <strong>lote</strong> es un conjunto de trabajos de generación. Cada trabajo = un modelo + una prenda + una pose.</p>
          <div className="space-y-2">
            <Step n={1} text={<>Hacé clic en <strong>Nuevo lote</strong> en la barra superior, o en <strong>Generar</strong> en el menú.</>} />
            <Step n={2} text={<>Seleccioná el <strong>cliente</strong> y el <strong>modelo fotográfico</strong> que vas a usar.</>} />
            <Step n={3} text={<>Subí la(s) <strong>prenda(s)</strong>. Podés subir varias a la vez para procesarlas en un mismo lote.</>} />
            <Step n={4} text={<>Elegí el <strong>proveedor de IA</strong>, el <strong>formato</strong> de imagen y configurá el <strong>fondo</strong> deseado.</>} />
            <Step n={5} text={<>Revisá el resumen y hacé clic en <strong>Iniciar generación</strong>. El sistema enviará todos los trabajos a la cola automáticamente.</>} />
          </div>
          <Note>Cuantas más prendas y poses incluyas, más trabajos se crean en paralelo. Podés seguir el progreso en la sección Cola.</Note>
          <Note tone="warning">Si el proveedor está lento o con errores, el sistema reintenta automáticamente. No hace falta que hagas nada.</Note>
        </Section>

        {/* Cola */}
        <Section icon={<Rows3 className="w-5 h-5" />} title="Cola de trabajos">
          <p>La <strong>Cola</strong> muestra todos los trabajos activos: pendientes, procesándose, completados y fallidos.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li><strong>Pendiente:</strong> el trabajo está en espera de ser tomado por el sistema.</li>
            <li><strong>Procesando:</strong> la IA está generando la imagen en este momento.</li>
            <li><strong>Completado:</strong> la imagen fue generada correctamente.</li>
            <li><strong>Fallido:</strong> el proveedor devolvió un error. El sistema reintentará automáticamente hasta 3 veces.</li>
          </ul>
          <p>
            En la columna <strong>"Fallidos reintentables"</strong> aparecen los trabajos que agotaron los reintentos automáticos. Podés reencolarlos manualmente desde ahí o desde la sección Evaluación.
          </p>
          <Note>El indicador de cola en la barra superior muestra cuántos trabajos están activos en tiempo real.</Note>
        </Section>

        {/* Evaluación */}
        <Section icon={<Eye className="w-5 h-5" />} title="Evaluación de resultados">
          <p>En <strong>Evaluación</strong> revisás los resultados de cada lote. Podés ver todas las imágenes generadas organizadas por lote.</p>
          <div className="space-y-2">
            <Step n={1} text="Seleccioná el lote que querés revisar desde el selector de la barra superior." />
            <Step n={2} text={<>Por cada imagen podés ver el resultado, el modelo usado y el proveedor de IA. Si la imagen no es correcta, hacé clic en <strong>Regenerar foto</strong>.</>} />
            <Step n={3} text={<>Podés cambiar el <strong>proveedor</strong> o editar el <strong>prompt</strong> antes de regenerar para obtener un resultado diferente.</>} />
            <Step n={4} text={<>Usá los <strong>checkboxes</strong> para seleccionar varias imágenes a la vez y reencolarlas o descargarlas juntas.</>} />
          </div>
          <Note>El botón <strong>"Ver anterior"</strong> aparece cuando una imagen fue regenerada. Te permite comparar la versión nueva con la anterior lado a lado.</Note>
          <Note tone="warning">Los revisores pueden ver y descargar resultados, pero no pueden regenerar imágenes.</Note>
        </Section>

        {/* Archivo */}
        <Section icon={<Archive className="w-5 h-5" />} title="Archivo histórico">
          <p>El <strong>Archivo</strong> es el historial completo de todos los lotes generados. Podés buscar y filtrar por cliente, proveedor, fecha, estado, y más.</p>
          <div className="space-y-2">
            <Step n={1} text="Usá los filtros para encontrar lotes específicos. Podés combinar varios filtros a la vez." />
            <Step n={2} text="Hacé clic en un lote para ver todos sus trabajos y resultados." />
            <Step n={3} text={<>Desde un lote podés <strong>descargar</strong> todas las imágenes en un ZIP, o seleccionar imágenes individuales.</>} />
            <Step n={4} text={<>Si hay trabajos fallidos en un lote antiguo, podés <strong>reencolarlos</strong> desde el botón de reintento.</>} />
          </div>
          <Note>Las notificaciones de la campanita en la barra superior llevan directamente al lote correspondiente en el archivo.</Note>
        </Section>

        {/* Descargas */}
        <Section icon={<Download className="w-5 h-5" />} title="Descarga de imágenes">
          <p>Hay tres formas de descargar imágenes:</p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600">
            <li><strong>Individual:</strong> botón de descarga en cada tarjeta de imagen en Evaluación o Archivo.</li>
            <li><strong>Seleccionada:</strong> marcá varias imágenes con los checkboxes y usá el botón de descarga grupal.</li>
            <li><strong>Lote completo:</strong> desde el detalle de un lote en Archivo, descargá todas las imágenes completadas en un solo ZIP.</li>
          </ul>
          <Note>Los ZIPs incluyen solo imágenes con estado "completado". Las pendientes o fallidas no se incluyen.</Note>
        </Section>

        {/* Regenerar */}
        <Section icon={<RefreshCw className="w-5 h-5" />} title="Regenerar imágenes">
          <p>Si un resultado no es correcto podés <strong>regenerar</strong> la imagen. Esto crea un nuevo trabajo para esa pose+prenda y reemplaza el resultado anterior.</p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600">
            <li>Podés mantener el mismo proveedor y prompt, o cambiarlos antes de regenerar.</li>
            <li>La imagen anterior queda guardada. Podés verla con el botón <strong>"Ver anterior"</strong>.</li>
            <li>Para regenerar varios trabajos fallidos de un lote a la vez, usá el botón <strong>"Fallidos reintentables"</strong> en Cola o el botón de reintento en Archivo.</li>
          </ul>
          <Note tone="warning">
            Si el trabajo tiene un experimento A/B activo, el proveedor y el prompt quedan bloqueados para no invalidar la comparación.
          </Note>
        </Section>

        {/* Modelos */}
        <Section icon={<UserSquare2 className="w-5 h-5" />} title="Modelos fotográficos">
          <p>
            Los <strong>modelos</strong> son las personas que aparecen en las fotos de catálogo. Cada modelo tiene una o más <em>poses</em> (fotos base) que la IA usa como referencia para superponer la prenda.
          </p>
          <p>
            Cuantas más poses tenga un modelo, más variedad de ángulos podrás generar en cada lote.
          </p>
          <Note>La gestión de modelos (crear, editar, archivar) es exclusiva del rol administrador.</Note>
        </Section>

        {/* Tips */}
        <Section icon={<CheckCircle2 className="w-5 h-5" />} title="Consejos y buenas prácticas">
          <ul className="list-disc list-inside space-y-2 text-gray-600">
            <li><strong>Fotos de prenda limpias:</strong> las prendas sobre fondo blanco o neutro y sin arrugas dan mejores resultados.</li>
            <li><strong>Un lote por tipo de prenda:</strong> si las prendas son muy distintas (remera vs. campera), generarlas en lotes separados facilita la revisión.</li>
            <li><strong>Revisá el prompt:</strong> si el resultado no es lo que esperabas, revisar el prompt antes de regenerar suele ayudar.</li>
            <li><strong>Fondo blanco para catálogo:</strong> para imágenes de e-commerce estándar, el fondo blanco da los resultados más limpios y consistentes.</li>
            <li><strong>Usá el archivo como referencia:</strong> buscá lotes anteriores exitosos para ver qué configuración funcionó bien con ese tipo de prenda.</li>
          </ul>
        </Section>

      </div>
    </div>
  );
};
