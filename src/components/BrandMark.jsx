import { brand } from '../config/brand'

export default function BrandMark({ className = '' }) {
  return <span className={className} aria-hidden="true"><img src={brand.icon} alt="" /></span>
}
