// A bounded, portable design description. Coordinates are in a 860px canvas.
export function normalizeVisual(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Number.isFinite(value.height) || value.height < 1 || value.height > 20000 || !Array.isArray(value.layers) || value.layers.length > 100) throw new Error('Invalid visual design');
  const color = (v) => { if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Invalid visual color'); return v.toLowerCase(); };
  const number = (v, min, max) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error('Invalid visual coordinate'); return v; };
  const layers = value.layers.map((layer) => {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) throw new Error('Invalid visual layer');
    const base = {type:layer.type, x:number(layer.x,0,860), y:number(layer.y,0,value.height), width:number(layer.width,1,860), height:number(layer.height,1,value.height)};
    if (base.x + base.width > 860 || base.y + base.height > value.height) throw new Error('Visual layer exceeds section');
    if (layer.type === 'image') return base;
    if (layer.type === 'text') {
      if (!['heading','body','bullets'].includes(layer.field)) throw new Error('Invalid visual text field');
      return {...base,field:layer.field,fontSize:number(layer.fontSize,8,200),color:color(layer.color),weight:layer.weight === 'bold' ? 'bold' : 'regular'};
    }
    if (layer.type === 'rectangle') return {...base,color:color(layer.color),radius:number(layer.radius ?? 0,0,430)};
    if (layer.type === 'gradient') return {...base,from:color(layer.from),to:color(layer.to),direction:layer.direction === 'horizontal' ? 'horizontal' : 'vertical'};
    throw new Error('Invalid visual layer type');
  });
  return {version:1,height:value.height,layers};
}
