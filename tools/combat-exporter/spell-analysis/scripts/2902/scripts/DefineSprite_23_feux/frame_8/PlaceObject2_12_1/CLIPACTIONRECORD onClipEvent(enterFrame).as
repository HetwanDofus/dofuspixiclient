onClipEvent(enterFrame){
   if(random(15) == 1)
   {
      _parent._parent.attachMovie("minifeux2","minifeux2" + compte,compte);
      eval("_parent._parent.minifeux2" + compte)._x = _X;
      eval("_parent._parent.minifeux2" + compte)._y = _Y + _parent._y;
      eval("_parent._parent.minifeux2" + compte)._alpha = 100 - c++;
      compte = random(200000);
   }
   _rotation = _rotation + t / 3;
   t--;
   _xscale = t / 3;
   _yscale = t / 3;
   _parent._y += g;
   _X = _X + (vx *= accx);
   _Y = _Y + (vy *= accy);
   if(t < 0)
   {
      _parent.removeMovieClip();
   }
}
