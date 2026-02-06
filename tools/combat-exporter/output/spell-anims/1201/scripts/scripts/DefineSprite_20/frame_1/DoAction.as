i = -10 * Math.random();
amp = 15 + 5 * Math.random();
vr = 0.067;
this.onEnterFrame = function()
{
   vr *= 0.95;
   _Y = amp * Math.sin(i += vr);
   this.swapDepths(Math.round(1000 * Math.cos(i)));
};
