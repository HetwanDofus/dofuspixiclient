t = random(_parent.t) + _parent.t;
_xscale = 0;
_yscale = 0;
this.onEnterFrame = function()
{
   _xscale = _xscale + t;
   _yscale = _yscale + t;
   t /= 1.6;
};
