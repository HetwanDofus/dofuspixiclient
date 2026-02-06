angle = _parent._parent.angle;
v = 0.67 + random(5);
va = 20 * (-0.5 + Math.random());
t = 100;
this.onEnterFrame = function()
{
   if(random(5) == 0)
   {
      va = 20 * (-0.5 + Math.random());
   }
   _xscale = v * 10;
   t *= 0.999;
   angle += va;
   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
   vy = v * Math.sin(angle * 0.017453292519943295);
   _X = _X + vx;
   _Y = _Y + vy;
   v *= 0.95;
   _rotation = angle;
};
