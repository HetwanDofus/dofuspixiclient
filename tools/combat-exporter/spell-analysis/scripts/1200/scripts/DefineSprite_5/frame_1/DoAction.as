vi = 4.8;
vx = (-0.5 + Math.random()) * vi;
vy = (-0.5 + Math.random()) * vi / 2;
size = random(80) + 40;
vs = 10 + 10 * Math.random();
va = 0.5 + random(3.4);
_alpha = 60 + random(50);
acc = 0.84 + 0.15 * Math.random();
this.onEnterFrame = function()
{
   _alpha = _alpha - va;
   t = size += vs;
   vs *= 0.23;
   _xscale = t;
   _yscale = t;
   _X = _X + vx;
   _Y = _Y + vy;
   vx *= acc;
   vy *= acc;
};
