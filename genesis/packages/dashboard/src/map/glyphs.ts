import type { StructureInfo, StructureKind } from "@genesis/protocol";

const TAU = Math.PI * 2;

/** Color representativo por tipo (para leyendas y para el zoom mínimo). */
export const STRUCTURE_COLORS: Record<StructureKind, string> = {
  refugio: "#d2a679",
  fogata: "#ff9d3c",
  muro: "#a9a9a9",
  granja: "#8fbf3f",
  almacen: "#d8c48f",
  taller: "#c4c4c4",
  horno: "#c27a4b",
  templo: "#e9dcff",
  mercado: "#f28c8c",
  tumba: "#9a9a9a",
  monumento: "#f0f0f0",
};

function tri(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
}

/**
 * Dibuja el glifo de una estructura centrado en (cx, cy); `s` es el tamaño
 * de referencia en píxeles (≈ una celda, acotado). Las obras en construcción
 * se dibujan semitransparentes según `progress`.
 */
export function drawStructure(ctx: CanvasRenderingContext2D, st: StructureInfo, cx: number, cy: number, s: number): void {
  const building = st.progress < 1;
  const prevAlpha = ctx.globalAlpha;
  if (building) ctx.globalAlpha = prevAlpha * (0.3 + 0.6 * Math.max(0, Math.min(1, st.progress)));
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  switch (st.kind) {
    case "refugio": {
      ctx.fillStyle = "#c9a27a";
      ctx.fillRect(cx - s * 0.28, cy - s * 0.02, s * 0.56, s * 0.36);
      ctx.strokeRect(cx - s * 0.28, cy - s * 0.02, s * 0.56, s * 0.36);
      ctx.fillStyle = "#8f5b3a";
      tri(ctx, cx - s * 0.38, cy - s * 0.02, cx + s * 0.38, cy - s * 0.02, cx, cy - s * 0.42);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "fogata": {
      if (st.lit) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.7);
        g.addColorStop(0, "rgba(255,170,60,0.55)");
        g.addColorStop(1, "rgba(255,120,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#ffb347";
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#fff1c2";
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.09, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = "#7d7d7d";
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.15, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "muro": {
      ctx.fillStyle = "#a3a3a3";
      ctx.fillRect(cx - s * 0.36, cy - s * 0.36, s * 0.72, s * 0.72);
      ctx.strokeRect(cx - s * 0.36, cy - s * 0.36, s * 0.72, s * 0.72);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.36, cy);
      ctx.lineTo(cx + s * 0.36, cy);
      ctx.stroke();
      break;
    }
    case "granja": {
      ctx.fillStyle = "#6f9331";
      ctx.fillRect(cx - s * 0.38, cy - s * 0.38, s * 0.76, s * 0.76);
      ctx.strokeRect(cx - s * 0.38, cy - s * 0.38, s * 0.76, s * 0.76);
      ctx.strokeStyle = "#e0c65a";
      ctx.lineWidth = Math.max(1, s * 0.08);
      for (let i = -0.22; i <= 0.23; i += 0.22) {
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.3, cy + i * s);
        ctx.lineTo(cx + s * 0.3, cy + i * s);
        ctx.stroke();
      }
      break;
    }
    case "templo": {
      ctx.fillStyle = "#e6d8ff";
      tri(ctx, cx - s * 0.48, cy + s * 0.4, cx + s * 0.48, cy + s * 0.4, cx, cy - s * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#6b4fd1";
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.12, 0, TAU);
      ctx.fill();
      break;
    }
    case "mercado": {
      ctx.fillStyle = "#f2f2f2";
      ctx.fillRect(cx - s * 0.4, cy - s * 0.2, s * 0.8, s * 0.5);
      ctx.strokeRect(cx - s * 0.4, cy - s * 0.2, s * 0.8, s * 0.5);
      ctx.fillStyle = "#e05a5a";
      for (let i = 0; i < 4; i += 2) ctx.fillRect(cx - s * 0.4 + (i * s * 0.8) / 4, cy - s * 0.2, s * 0.2, s * 0.14);
      break;
    }
    case "taller": {
      ctx.fillStyle = "#bdbdbd";
      ctx.fillRect(cx - s * 0.34, cy - s * 0.34, s * 0.68, s * 0.68);
      ctx.strokeRect(cx - s * 0.34, cy - s * 0.34, s * 0.68, s * 0.68);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = Math.max(1, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy + s * 0.2);
      ctx.lineTo(cx + s * 0.2, cy - s * 0.2);
      ctx.stroke();
      break;
    }
    case "horno": {
      ctx.fillStyle = "#b8744a";
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.1, s * 0.36, Math.PI, TAU);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = st.lit ? "#ff8c3a" : "#3a2a1e";
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.1, s * 0.14, Math.PI, TAU);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "almacen": {
      ctx.fillStyle = "#d4c493";
      ctx.fillRect(cx - s * 0.38, cy - s * 0.28, s * 0.76, s * 0.6);
      ctx.strokeRect(cx - s * 0.38, cy - s * 0.28, s * 0.76, s * 0.6);
      ctx.strokeStyle = "#7d6b45";
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.12, cy - s * 0.28);
      ctx.lineTo(cx - s * 0.12, cy + s * 0.32);
      ctx.moveTo(cx + s * 0.12, cy - s * 0.28);
      ctx.lineTo(cx + s * 0.12, cy + s * 0.32);
      ctx.stroke();
      break;
    }
    case "tumba": {
      ctx.fillStyle = "#8f8f8f";
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.22, cy + s * 0.32);
      ctx.lineTo(cx - s * 0.22, cy - s * 0.1);
      ctx.arc(cx, cy - s * 0.1, s * 0.22, Math.PI, TAU);
      ctx.lineTo(cx + s * 0.22, cy + s * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.2);
      ctx.lineTo(cx, cy + s * 0.14);
      ctx.moveTo(cx - s * 0.1, cy - s * 0.08);
      ctx.lineTo(cx + s * 0.1, cy - s * 0.08);
      ctx.stroke();
      break;
    }
    case "monumento": {
      ctx.fillStyle = "#5a5a5a";
      ctx.fillRect(cx - s * 0.3, cy + s * 0.3, s * 0.6, s * 0.14);
      ctx.fillStyle = "#ececec";
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.14, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.14, cy + s * 0.3);
      ctx.lineTo(cx + s * 0.07, cy - s * 0.42);
      ctx.lineTo(cx, cy - s * 0.55);
      ctx.lineTo(cx - s * 0.07, cy - s * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.globalAlpha = prevAlpha;
}
