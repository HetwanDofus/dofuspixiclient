onClipEvent(enterFrame){
   _yscale = _yscale * 1.02;
   _Y = _Y - (v *= 0.97);
   _alpha = _alpha - va;
   if(_alpha < 0)
   {
      _parent.removeMovieClip();
   }
}
