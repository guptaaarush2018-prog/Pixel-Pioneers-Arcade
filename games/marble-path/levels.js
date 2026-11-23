/* Marble Path levels. walls: [x1, y1, x2, y2]; bumpers: [x, y, r]; inv: pieces you get. par is the
   fewest pieces a solver needed, and hint is that solution (ramp angles in 15-degree steps); the
   game shows its first piece after a few misses. */
window.MARBLE_LEVELS = [
  {"name":"First Drop","start":[150,50],"cup":[560,490],"inv":{"ramp":1,"bumper":0},"walls":[[90,170,330,235]],"par":1,"hint":[{"type":"ramp","x":380,"y":320,"a":-1}]},
  {"name":"Bounce House","start":[120,50],"cup":[660,300],"inv":{"ramp":1,"bumper":1},"walls":[[0,520,420,520],[620,340,800,340]],"par":2,"hint":[{"type":"ramp","x":100,"y":260,"a":4},{"type":"bumper","x":200,"y":420}]},
  {"name":"Over the Wall","start":[140,50],"cup":[640,490],"inv":{"ramp":1,"bumper":1},"walls":[[60,200,380,330],[420,180,420,540]],"par":2,"hint":[{"type":"ramp","x":360,"y":160,"a":-1},{"type":"bumper","x":120,"y":120}]},
  {"name":"Zig Zag","start":[700,40],"cup":[110,490],"inv":{"ramp":2,"bumper":0},"walls":[[560,150,760,210],[300,300,520,330],[600,420,780,460]],"par":1,"hint":[{"type":"ramp","x":660,"y":80,"a":-2}]},
  {"name":"Pinball","start":[400,40],"cup":[700,480],"inv":{"ramp":1,"bumper":0},"walls":[[0,530,600,530]],"bumpers":[[400,220,20],[300,330,20],[520,360,20],[180,420,20]],"par":1,"hint":[{"type":"ramp","x":440,"y":220,"a":2}]},
  {"name":"The Gap","start":[90,50],"cup":[720,370],"inv":{"ramp":1,"bumper":1},"walls":[[40,180,300,260],[560,410,800,410],[560,410,560,540]],"par":1,"hint":[{"type":"bumper","x":400,"y":340}]},
  {"name":"Long Way Round","start":[100,40],"cup":[140,490],"inv":{"ramp":2,"bumper":1},"walls":[[40,150,600,220],[220,340,780,300],[240,340,240,540],[20,380,200,380]],"par":3,"hint":[{"type":"ramp","x":120,"y":400,"a":5},{"type":"ramp","x":620,"y":180,"a":4},{"type":"bumper","x":200,"y":460}]},
  {"name":"Upstairs","start":[120,40],"cup":[680,170],"inv":{"ramp":1,"bumper":2},"walls":[[0,530,800,530],[600,210,800,210],[600,210,600,400]],"par":2,"hint":[{"type":"bumper","x":420,"y":280},{"type":"bumper","x":100,"y":120}]},
  {"name":"Tight Squeeze","start":[700,40],"cup":[400,490],"inv":{"ramp":2,"bumper":0},"walls":[[300,400,360,400],[440,400,500,400],[300,400,300,530],[500,400,500,530],[560,160,780,200]],"par":1,"hint":[{"type":"ramp","x":720,"y":100,"a":-2}]},
  {"name":"Grand Finale","start":[60,40],"cup":[720,480],"inv":{"ramp":2,"bumper":2},"walls":[[20,160,260,200],[360,120,360,420],[360,420,560,420],[560,260,560,420],[460,260,780,200]],"bumpers":[[200,450,20]],"par":2,"hint":[{"type":"ramp","x":620,"y":500,"a":-2},{"type":"bumper","x":300,"y":480}]},
];
