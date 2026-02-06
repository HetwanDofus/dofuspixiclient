vx = 7.5 * (-0.5 + Math.random());
vy = 3.75 * (-0.5 + Math.random());
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + vy;
};
