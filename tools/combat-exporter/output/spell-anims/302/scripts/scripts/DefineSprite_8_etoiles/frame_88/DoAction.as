stop();
accx = 0.1 + 0.1 * Math.random();
accy = 0.05;
t = 0;
tf = 90 + random(60);
vx = 0;
vy = -3 - 10 * Math.random();
end = 0;
this.onEnterFrame = function()
{
   if(_X < 0)
   {
      vx += accx;
   }
   if(_X > 0)
   {
      vx -= accx;
   }
   if(_Y < -20)
   {
      vy += accy;
   }
   if(_Y > -20)
   {
      vy -= accy;
   }
   _X = _X + vx;
   _Y = _Y + vy;
   vx *= 0.9999;
   vy *= 0.9555;
   if(t++ > tf & end != 1)
   {
      play();
      end = 1;
   }
};
