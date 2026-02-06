angle = 360 * Math.random();
v = 6.67 + random(20);
va = 40 * (-0.5 + Math.random());
t = 100;
this.onEnterFrame = function()
{
   if(random(2) == 0)
   {
      va = 40 * (-0.5 + Math.random());
   }
   _xscale = v * 14;
   t *= 0.95;
   angle += va;
   vx = v * Math.cos(angle * 0.017453292519943295);
   vy = v * Math.sin(angle * 0.017453292519943295);
   _X = _X + vx;
   _Y = _Y + vy;
   v *= 0.9;
   _rotation = angle;
};
