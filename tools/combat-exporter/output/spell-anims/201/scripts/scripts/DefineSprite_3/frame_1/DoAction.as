v = 1.6 + random(5);
va = 3;
this.onEnterFrame = function()
{
   _X = _X - (v /= 1.4);
   _alpha = _alpha - va;
};
