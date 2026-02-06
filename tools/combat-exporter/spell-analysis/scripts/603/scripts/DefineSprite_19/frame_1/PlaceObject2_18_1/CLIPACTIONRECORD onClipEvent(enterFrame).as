onClipEvent(enterFrame){
   if(this._y > -100 & this._parent._alpha < 100)
   {
      _parent._alpha += 6.6;
   }
   if(this._y < -100)
   {
      this._parent._alpha -= 6.6;
      if(this._parent._alpha < 0)
      {
         this._parent._visible = 0;
         this.stop = 1;
         this._parent.removeMovieClip();
      }
   }
   _rotation = _rotation;
   this._y = 5 * (r += 0.01) * Math.cos(i) + (p -= v);
   this._x = 25 * r * Math.sin(i += v2);
   if(Math.sin(i) > 0)
   {
      this._alpha -= 1.3;
   }
   else
   {
      this._alpha += 1.3;
   }
}
