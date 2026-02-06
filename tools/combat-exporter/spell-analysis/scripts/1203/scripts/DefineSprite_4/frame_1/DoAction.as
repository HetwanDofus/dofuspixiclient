angle = _parent._parent.angle;
v = 0.67 + random(5);
va = 20 * (-0.5 + Math.random());
t = 70 + random(30);
this.onEnterFrame = function()
{
   if(random(3) == 1)
   {
      va = 20 * (-0.5 + Math.random());
   }
   _xscale = t;
   _yscale = t;
   t *= 0.975;
   angle += va;
   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
   vy = v * Math.sin(angle * 0.017453292519943295);
   _X = _X + vx;
   _Y = _Y + vy;
   v *= 0.95;
};
